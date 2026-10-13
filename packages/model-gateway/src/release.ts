import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  FIREWORKS_ENDPOINT,
  OpaqueIdSchema,
  PROMPT_VERSION,
  SCHEMA_VERSION,
  TASK_VERSION,
  type GatewayErrorCode,
  type GatewayRequest,
} from './contracts.js';
import {
  OBSERVATION_JSON_SCHEMA,
  SYSTEM_PROMPT,
  VALIDATOR_RULES,
  VALIDATOR_VERSION,
} from './task.js';

export const REQUEST_MODELS = [
  'accounts/fireworks/routers/glm-5p3-flash-us',
  'accounts/fireworks/routers/deepseek-v4p1-flash-us',
] as const;

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const ResponseModelSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_./-]+$/);
export const ReleaseLimitsSchema = z
  .object({
    requestBytes: z.number().int().min(1).max(131_072),
    responseBytes: z.number().int().min(1).max(1_048_576),
    outputTokens: z.number().int().min(1).max(4096),
    deadlineMs: z.number().int().min(1).max(30_000),
    maxAttempts: z.union([z.literal(1), z.literal(2)]),
  })
  .strict();
export const MAXIMUM_LIMITS: z.infer<typeof ReleaseLimitsSchema> = Object.freeze({
  requestBytes: 131_072,
  responseBytes: 1_048_576,
  outputTokens: 4096,
  deadlineMs: 30_000,
  maxAttempts: 2,
});

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export const CONTRACT_FINGERPRINTS = Object.freeze({
  prompt: sha256(SYSTEM_PROMPT),
  schema: sha256(JSON.stringify(OBSERVATION_JSON_SCHEMA)),
  validator: sha256(`${VALIDATOR_VERSION}\n${VALIDATOR_RULES}`),
});

export const ReleasePolicySchema = z
  .object({
    id: OpaqueIdSchema,
    state: z.enum(['CANDIDATE', 'SYNTHETIC_EVALUATION', 'APPROVED', 'DISABLED']),
    endpoint: z.literal(FIREWORKS_ENDPOINT),
    requestModel: z.enum(REQUEST_MODELS),
    responseModels: z.array(ResponseModelSchema).max(8),
    task: z.literal(TASK_VERSION),
    promptVersion: z.literal(PROMPT_VERSION),
    schemaVersion: z.literal(SCHEMA_VERSION),
    fingerprints: z
      .object({ prompt: HashSchema, schema: HashSchema, validator: HashSchema })
      .strict(),
    implementationArtifactSha256: HashSchema.nullable(),
    organizations: z.array(OpaqueIdSchema).max(100),
    limits: ReleaseLimitsSchema,
    evidence: z
      .object({
        publisherArtifactRevision: OpaqueIdSchema,
        licenseSha256: HashSchema,
        servingRevision: OpaqueIdSchema,
        regionPolicyEvidenceId: OpaqueIdSchema,
        retentionPolicyEvidenceId: OpaqueIdSchema,
        priceSnapshotId: OpaqueIdSchema,
        protectedDataApprovalId: OpaqueIdSchema.nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type ReleasePolicy = z.infer<typeof ReleasePolicySchema>;

export const ReleaseSchema = z
  .object({
    policy: ReleasePolicySchema,
    approval: z
      .object({
        policySha256: HashSchema,
        reviewerId: OpaqueIdSchema,
        evaluationId: OpaqueIdSchema,
        runAuthorizationId: OpaqueIdSchema,
        reviewedAt: z.string().datetime(),
        expiresAt: z.string().datetime(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type ModelRelease = z.infer<typeof ReleaseSchema>;

/** Canonical schema parsing fixes property order and rejects unknown policy fields. */
export function releasePolicyHash(policy: ReleasePolicy): string {
  return sha256(JSON.stringify(ReleasePolicySchema.parse(policy)));
}

function candidate(id: string, requestModel: ReleasePolicy['requestModel']): ModelRelease {
  return {
    policy: {
      id,
      state: 'CANDIDATE',
      endpoint: FIREWORKS_ENDPOINT,
      requestModel,
      responseModels: [],
      task: TASK_VERSION,
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      fingerprints: CONTRACT_FINGERPRINTS,
      implementationArtifactSha256: null,
      organizations: [],
      limits: MAXIMUM_LIMITS,
      evidence: null,
    },
    approval: null,
  };
}

// These are research candidates. Neither credentials nor runtime selection can promote them.
function candidateReleases(): ModelRelease[] {
  return [
    candidate('glm-flash-claim-observation.v1', REQUEST_MODELS[0]),
    candidate('deepseek-flash-claim-observation.v1', REQUEST_MODELS[1]),
  ];
}
export const CANDIDATE_RELEASES: readonly ModelRelease[] = candidateReleases();

export type ReleaseResolution =
  | { readonly ok: true; readonly release: ModelRelease }
  | { readonly ok: false; readonly code: GatewayErrorCode };

export interface ReleaseRegistry {
  resolve(request: GatewayRequest): ReleaseResolution;
}

export function createReleaseRegistry(
  options: {
    readonly releases?: readonly ModelRelease[];
    readonly implementationArtifactSha256?: string;
  } = {},
): ReleaseRegistry {
  const parsed = z
    .array(ReleaseSchema)
    .max(100)
    .safeParse(options.releases ?? candidateReleases());
  const entries = parsed.success ? parsed.data : [];
  const valid =
    parsed.success && new Set(entries.map((entry) => entry.policy.id)).size === entries.length;
  const artifactHash = options.implementationArtifactSha256;
  return {
    resolve(request): ReleaseResolution {
      if (!valid) return { ok: false, code: 'CONFIGURATION_ERROR' };
      const release = entries.find((entry) => entry.policy.id === request.releaseId);
      if (!release) return { ok: false, code: 'RELEASE_NOT_FOUND' };
      const { policy, approval } = release;
      if (policy.state === 'DISABLED') return { ok: false, code: 'RELEASE_DISABLED' };
      if (
        policy.state === 'CANDIDATE' ||
        !approval ||
        !policy.evidence ||
        policy.responseModels.length === 0
      ) {
        return { ok: false, code: 'RELEASE_UNAPPROVED' };
      }
      if (
        !policy.organizations.includes(request.organizationId) ||
        (request.dataClass === 'PROTECTED' &&
          (policy.state !== 'APPROVED' || !policy.evidence.protectedDataApprovalId))
      ) {
        return { ok: false, code: 'RELEASE_SCOPE_MISMATCH' };
      }
      const now = Date.now();
      if (
        Date.parse(approval.reviewedAt) > now ||
        Date.parse(approval.expiresAt) <= now ||
        Date.parse(approval.expiresAt) <= Date.parse(approval.reviewedAt)
      ) {
        return { ok: false, code: 'RELEASE_UNAPPROVED' };
      }
      if (
        approval.policySha256 !== releasePolicyHash(policy) ||
        policy.fingerprints.prompt !== CONTRACT_FINGERPRINTS.prompt ||
        policy.fingerprints.schema !== CONTRACT_FINGERPRINTS.schema ||
        policy.fingerprints.validator !== CONTRACT_FINGERPRINTS.validator ||
        !artifactHash ||
        !HashSchema.safeParse(artifactHash).success ||
        policy.implementationArtifactSha256 !== artifactHash
      ) {
        return { ok: false, code: 'RELEASE_INTEGRITY_FAILED' };
      }
      // Return a fresh copy: a caller cannot mutate the registry's subsequent decisions.
      return { ok: true, release: structuredClone(release) };
    },
  };
}
