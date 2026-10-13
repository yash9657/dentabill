import { describe, expect, it } from 'vitest';

import {
  CANDIDATE_RELEASES,
  createReleaseRegistry,
  releasePolicyHash,
  type ModelRelease,
} from './release.js';
import { releaseFixture, requestFixture, TEST_ARTIFACT_HASH } from './test-fixtures.js';

function resolve(release: ModelRelease, artifactHash: string | undefined = TEST_ARTIFACT_HASH) {
  return createReleaseRegistry({
    releases: [release],
    ...(artifactHash ? { implementationArtifactSha256: artifactHash } : {}),
  }).resolve(requestFixture());
}

describe('server-owned release policy', () => {
  it('has no enabled or implicit default release', () => {
    expect(CANDIDATE_RELEASES).toHaveLength(2);
    for (const release of CANDIDATE_RELEASES) {
      expect(release.policy.state).toBe('CANDIDATE');
      expect(
        createReleaseRegistry().resolve({ ...requestFixture(), releaseId: release.policy.id }),
      ).toEqual({ ok: false, code: 'RELEASE_UNAPPROVED' });
    }
    expect(createReleaseRegistry().resolve(requestFixture())).toEqual({
      ok: false,
      code: 'RELEASE_NOT_FOUND',
    });
  });

  it('resolves only a scoped, approved policy bound to this implementation artifact', () => {
    expect(resolve(releaseFixture())).toMatchObject({ ok: true });
    expect(resolve(releaseFixture(), '3'.repeat(64))).toEqual({
      ok: false,
      code: 'RELEASE_INTEGRITY_FAILED',
    });
    expect(
      createReleaseRegistry({ releases: [releaseFixture()] }).resolve(requestFixture()),
    ).toEqual({ ok: false, code: 'RELEASE_INTEGRITY_FAILED' });
  });

  it.each([
    ['endpoint', 'https://api.fireworks.ai/inference/v1/chat/completions'],
    ['endpoint', 'https://us.api.fireworks.ai/inference/v1/chat/completions?key=private'],
    ['requestModel', 'accounts/fireworks/models/auto'],
    ['requestModel', 'accounts/fireworks/routers/glm-latest'],
    ['requestModel', 'accounts/unknown/models/model'],
  ])('rejects unapproved %s at configuration parsing', (field, value) => {
    const release = releaseFixture();
    const invalid = { ...release, policy: { ...release.policy, [field]: value } };
    expect(resolve(invalid)).toEqual({ ok: false, code: 'CONFIGURATION_ERROR' });
  });

  it('rejects extras, duplicate release IDs and widened safety limits', () => {
    const release = releaseFixture();
    expect(resolve({ ...release, unsafeFallback: 'closed-model' } as ModelRelease)).toEqual({
      ok: false,
      code: 'CONFIGURATION_ERROR',
    });
    expect(
      createReleaseRegistry({ releases: [release, release] }).resolve(requestFixture()),
    ).toEqual({ ok: false, code: 'CONFIGURATION_ERROR' });
    release.policy.limits.maxAttempts = 3 as 2;
    expect(resolve(release)).toEqual({ ok: false, code: 'CONFIGURATION_ERROR' });
  });

  it.each(['schema', 'prompt', 'validator'] as const)(
    'rejects changed %s fingerprints even with a matching approval digest',
    (field) => {
      const release = releaseFixture();
      release.policy.fingerprints = { ...release.policy.fingerprints, [field]: '0'.repeat(64) };
      release.approval!.policySha256 = releasePolicyHash(release.policy);
      expect(resolve(release)).toEqual({ ok: false, code: 'RELEASE_INTEGRITY_FAILED' });
    },
  );

  it('invalidates approval when organization, model identity or budget changes', () => {
    for (const mutate of [
      (release: ModelRelease) => {
        release.policy.organizations.push('another-org');
      },
      (release: ModelRelease) => {
        release.policy.responseModels.push('some-model');
      },
      (release: ModelRelease) => {
        release.policy.limits.outputTokens = 512;
      },
    ]) {
      const release = releaseFixture();
      mutate(release);
      expect(resolve(release)).toEqual({ ok: false, code: 'RELEASE_INTEGRITY_FAILED' });
    }
  });

  it('cannot use synthetic evaluation approval for protected inputs or another tenant', () => {
    const registry = createReleaseRegistry({
      releases: [releaseFixture()],
      implementationArtifactSha256: TEST_ARTIFACT_HASH,
    });
    expect(registry.resolve({ ...requestFixture(), dataClass: 'PROTECTED' })).toEqual({
      ok: false,
      code: 'RELEASE_SCOPE_MISMATCH',
    });
    expect(registry.resolve({ ...requestFixture(), organizationId: 'other-org' })).toEqual({
      ok: false,
      code: 'RELEASE_SCOPE_MISMATCH',
    });
  });

  it('requires separate protected-data evidence in an approved workload', () => {
    const release = releaseFixture();
    release.policy.state = 'APPROVED';
    release.approval!.policySha256 = releasePolicyHash(release.policy);
    const request = { ...requestFixture(), dataClass: 'PROTECTED' as const };
    const registry = () =>
      createReleaseRegistry({
        releases: [release],
        implementationArtifactSha256: TEST_ARTIFACT_HASH,
      });
    expect(registry().resolve(request)).toEqual({ ok: false, code: 'RELEASE_SCOPE_MISMATCH' });
    release.policy.evidence!.protectedDataApprovalId = 'synthetic-contract-approval';
    release.approval!.policySha256 = releasePolicyHash(release.policy);
    expect(registry().resolve(request)).toMatchObject({ ok: true });
  });

  it('checks missing, expired and future-dated approval on every invocation', () => {
    for (const date of ['2000-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z']) {
      const release = releaseFixture();
      release.approval!.expiresAt = date;
      expect(resolve(release)).toEqual({ ok: false, code: 'RELEASE_UNAPPROVED' });
    }
    const release = releaseFixture();
    release.approval!.reviewedAt = '2099-01-01T00:00:00.000Z';
    expect(resolve(release)).toEqual({ ok: false, code: 'RELEASE_UNAPPROVED' });
    release.approval = null;
    expect(resolve(release)).toEqual({ ok: false, code: 'RELEASE_UNAPPROVED' });
  });

  it('honors disablement and requires measured response identity and serving evidence', () => {
    const release = releaseFixture();
    release.policy.state = 'DISABLED';
    expect(resolve(release)).toEqual({ ok: false, code: 'RELEASE_DISABLED' });
    release.policy.state = 'SYNTHETIC_EVALUATION';
    release.policy.responseModels = [];
    expect(resolve(release)).toEqual({ ok: false, code: 'RELEASE_UNAPPROVED' });
    release.policy.responseModels = ['fixture-model'];
    release.policy.evidence = null;
    expect(resolve(release)).toEqual({ ok: false, code: 'RELEASE_UNAPPROVED' });
  });

  it('isolates configuration and resolved policy from mutation', () => {
    const release = releaseFixture();
    const registry = createReleaseRegistry({
      releases: [release],
      implementationArtifactSha256: TEST_ARTIFACT_HASH,
    });
    release.policy.state = 'DISABLED';
    const first = registry.resolve(requestFixture());
    expect(first.ok).toBe(true);
    if (first.ok) first.release.policy.state = 'DISABLED';
    expect(registry.resolve(requestFixture())).toMatchObject({
      ok: true,
      release: { policy: { state: 'SYNTHETIC_EVALUATION' } },
    });
  });
});
