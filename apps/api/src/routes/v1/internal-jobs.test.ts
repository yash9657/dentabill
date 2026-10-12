/**
 * `POST /v1/internal/jobs/{calls,summaries}` — auth + trust boundary
 * (ADR-053). The runtime is replaced with a fake so no processor runs.
 */
import type { CallJobData, SummaryJobData } from '@dentabill/queue';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../../app.js';
import { initEnv } from '../../lib/env.js';
import type { InlineJobRuntime } from '../../lib/inline-jobs.js';

import { internalSecretMatches } from './internal-jobs.js';

const SECRET = 'test-internal-job-secret-0123456789abcdef';
const HEADER = 'x-internal-job-secret';

const callJob: CallJobData = {
  organizationId: 'org_1',
  claimId: 'claim_1',
  payerCode: 'DELTA_DENTAL_PPO',
  attemptNumber: 1,
  claimPriority: 50,
  idempotencyKey: 'claim_1-a1-k',
};
const summaryJob: SummaryJobData = {
  organizationId: 'org_1',
  callId: 'call_1',
  promptVersion: 'v1',
  idempotencyKey: 'call.call_1',
};

describe('internalSecretMatches', () => {
  it('matches only the exact configured secret', () => {
    expect(internalSecretMatches(SECRET, SECRET)).toBe(true);
    expect(internalSecretMatches(`${SECRET}x`, SECRET)).toBe(false);
    expect(internalSecretMatches('short', SECRET)).toBe(false);
    expect(internalSecretMatches(undefined, SECRET)).toBe(false);
    expect(internalSecretMatches(['a', 'b'], SECRET)).toBe(false);
  });

  it('never matches when no secret is configured', () => {
    expect(internalSecretMatches('', undefined)).toBe(false);
    expect(internalSecretMatches('anything', undefined)).toBe(false);
    expect(internalSecretMatches('', '')).toBe(false);
  });
});

describe('POST /v1/internal/jobs/*', () => {
  let server: FastifyInstance;
  const runCall = vi.fn<InlineJobRuntime['runCall']>();
  const runSummary = vi.fn<InlineJobRuntime['runSummary']>();

  beforeAll(async () => {
    process.env.INTERNAL_JOB_SECRET = SECRET;
    initEnv();
    server = await buildServer({ logger: false });
    server.inlineJobRuntime = { runCall, runSummary };
  });

  afterAll(async () => {
    await server.close();
    delete process.env.INTERNAL_JOB_SECRET;
    initEnv();
  });

  beforeEach(() => {
    runCall.mockReset().mockResolvedValue({ status: 'completed', attemptsMade: 1 });
    runSummary.mockReset().mockResolvedValue({ status: 'completed', attemptsMade: 1 });
  });

  it.each(['/v1/internal/jobs/calls', '/v1/internal/jobs/summaries'])(
    '%s returns 401 without the secret header',
    async (url) => {
      const response = await server.inject({ method: 'POST', url, payload: callJob });
      expect(response.statusCode).toBe(401);
      expect(runCall).not.toHaveBeenCalled();
      expect(runSummary).not.toHaveBeenCalled();
    },
  );

  it('returns 401 with a wrong secret', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/internal/jobs/calls',
      headers: { [HEADER]: `${SECRET.slice(0, -1)}X` },
      payload: callJob,
    });
    expect(response.statusCode).toBe(401);
    expect(runCall).not.toHaveBeenCalled();
  });

  it('returns 400 for a payload that fails the job schema', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/internal/jobs/calls',
      headers: { [HEADER]: SECRET },
      payload: { ...callJob, attemptNumber: 9 },
    });
    expect(response.statusCode).toBe(400);
    expect(runCall).not.toHaveBeenCalled();
  });

  it('acks a call job with 202 and runs it in the background', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/internal/jobs/calls',
      headers: { [HEADER]: SECRET },
      payload: callJob,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: true, jobId: callJob.idempotencyKey });
    expect(runCall).toHaveBeenCalledWith(callJob);
  });

  it('acks a summary job with 202 and runs it in the background', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/internal/jobs/summaries',
      headers: { [HEADER]: SECRET },
      payload: summaryJob,
    });
    expect(response.statusCode).toBe(202);
    expect(runSummary).toHaveBeenCalledWith(summaryJob);
  });

  it('is hidden from the OpenAPI document', async () => {
    const response = await server.inject({ method: 'GET', url: '/docs/json' });
    const doc = response.json<{ paths: Record<string, unknown> }>();
    expect(Object.keys(doc.paths).some((p) => p.includes('/internal/'))).toBe(false);
  });
});
