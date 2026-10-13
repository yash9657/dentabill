import { once } from 'node:events';
import { createServer, type Server } from 'node:http';

import { prisma } from '@dentabill/db';
import { createFireworksTransport } from '@dentabill/model-gateway';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  OBSERVATION_TEST_ARTIFACT,
  observationRelease,
  observationResponse,
  seedObservation,
} from './observation-inference.fixtures.js';
import { createDurableObservationGateway } from './observation-inference.js';
import {
  generateAndPublishObservation,
  publishStoredObservation,
} from './observation-publication.js';

const organizations: string[] = [];
const servers: Server[] = [];

async function fixture() {
  const input = await seedObservation(prisma);
  organizations.push(input.request.organizationId);
  let sends = 0;
  const server = createServer((incoming, response) => {
    incoming.resume();
    sends++;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(observationResponse(input.request));
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Synthetic provider unavailable.');
  const gateway = createDurableObservationGateway({
    prisma,
    callId: input.callId,
    dailyTokenLimit: 1_000_000,
    apiKey: 'synthetic-local-fixture',
    releases: [observationRelease(input.request.organizationId)],
    implementationArtifactSha256: OBSERVATION_TEST_ARTIFACT,
    transport: createFireworksTransport({
      fetch: async (url, init) => {
        expect(url).toBe('https://us.api.fireworks.ai/inference/v1/chat/completions');
        return fetch(`http://127.0.0.1:${String(address.port)}/fixture`, init);
      },
    }),
  });
  return { ...input, gateway, sends: () => sends };
}

beforeAll(async () => {
  await prisma.$connect();
});
afterEach(async () => {
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS fail_observation_publication ON "AuditLog"',
  );
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_observation_publication()');
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
  for (const organizationId of organizations.splice(0)) {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "ClaimObservationReview", "ClaimObservation" CASCADE',
    );
    await prisma.inferenceAttempt.deleteMany({ where: { organizationId } });
    await prisma.inferenceRun.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('Native inference to versioned observation publication', () => {
  it('publishes once, preserves the legacy summary and claim, and retries without another request', async () => {
    const input = await fixture();
    const legacy = await prisma.callSummary.create({
      data: {
        organizationId: input.request.organizationId,
        callId: input.callId,
        claimStatus: 'PENDING',
        nextAction: 'CALL_BACK',
        confidence: 0.8,
        notes: 'Synthetic earlier summary',
        rawTranscript: 'Synthetic original transcript',
        claudeSummary: '{}',
      },
    });
    const before = await prisma.claim.findFirstOrThrow({
      where: { id: input.request.claim.id, organizationId: input.request.organizationId },
    });
    const first = await generateAndPublishObservation({
      prisma,
      callId: input.callId,
      gateway: input.gateway,
      request: input.request,
    });
    expect(first.kind).toBe('PUBLISHED');
    const second = await generateAndPublishObservation({
      prisma,
      callId: input.callId,
      gateway: input.gateway,
      request: input.request,
    });
    expect(second).toMatchObject({
      kind: 'ALREADY_PUBLISHED',
      observation: { id: first.observation.id },
    });
    expect(input.sends()).toBe(1);
    expect(
      await prisma.callSummary.findFirst({
        where: { id: legacy.id, organizationId: input.request.organizationId },
      }),
    ).toEqual(legacy);
    expect(
      await prisma.claim.findFirst({
        where: { id: before.id, organizationId: input.request.organizationId },
      }),
    ).toEqual(before);
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { callId: input.callId, organizationId: input.request.organizationId },
    });
    expect(run).toMatchObject({ state: 'APPLIED', totalTokens: 31n });
    expect(
      await prisma.inferenceBudget.findFirst({
        where: { organizationId: input.request.organizationId },
      }),
    ).toMatchObject({ knownTokens: 31n });
    expect(first.observation).toMatchObject({
      dataClass: 'SYNTHETIC',
      releaseId: input.request.releaseId,
    });
  });

  it('replays a durable inference receipt after publication audit rollback without double inference', async () => {
    const input = await fixture();
    expect((await input.gateway.generate(input.request)).status).toBe('VALIDATED');
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { callId: input.callId, organizationId: input.request.organizationId },
    });
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION fail_observation_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."resourceType" = 'ClaimObservation' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END; $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER fail_observation_publication BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fail_observation_publication()',
    );
    await expect(
      publishStoredObservation({
        prisma,
        organizationId: input.request.organizationId,
        runId: run.id,
      }),
    ).rejects.toThrow();
    expect(
      await prisma.claimObservation.count({
        where: { organizationId: input.request.organizationId },
      }),
    ).toBe(0);
    expect(
      await prisma.inferenceRun.findFirst({
        where: { id: run.id, organizationId: input.request.organizationId },
      }),
    ).toMatchObject({ state: 'RESPONDED', totalTokens: 31n });
    await prisma.$executeRawUnsafe('DROP TRIGGER fail_observation_publication ON "AuditLog"');
    const resumed = await generateAndPublishObservation({
      prisma,
      callId: input.callId,
      gateway: input.gateway,
      request: input.request,
    });
    expect(resumed.kind).toBe('PUBLISHED');
    expect(input.sends()).toBe(1);
  });

  it('rejects stored output with fabricated evidence instead of exposing it as a finding', async () => {
    const input = await fixture();
    await input.gateway.generate(input.request);
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { callId: input.callId, organizationId: input.request.organizationId },
    });
    const payload = JSON.parse(JSON.stringify(run.resultPayload)) as {
      output: { status: { evidence: { quote: string }[] } };
    };
    payload.output.status.evidence[0]!.quote = 'Invented payer claim';
    await prisma.inferenceRun.update({
      where: { id: run.id, organizationId: input.request.organizationId },
      data: { resultPayload: payload },
    });
    await expect(
      publishStoredObservation({
        prisma,
        organizationId: input.request.organizationId,
        runId: run.id,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INFERENCE_RESULT' });
    expect(
      await prisma.claimObservation.count({
        where: { organizationId: input.request.organizationId },
      }),
    ).toBe(0);
    expect(input.sends()).toBe(1);
  });

  it('does not expose or publish another organization’s saved result', async () => {
    const first = await fixture();
    const other = await fixture();
    await first.gateway.generate(first.request);
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { callId: first.callId, organizationId: first.request.organizationId },
    });
    await expect(
      publishStoredObservation({
        prisma,
        organizationId: other.request.organizationId,
        runId: run.id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      await prisma.claimObservation.count({
        where: { organizationId: first.request.organizationId },
      }),
    ).toBe(0);
  });

  it('rejects another call’s transcript for the same claim before reservation or HTTP', async () => {
    const input = await fixture();
    const otherCall = await prisma.call.create({
      data: {
        organizationId: input.request.organizationId,
        claimId: input.request.claim.id,
        retellCallId: `synthetic-other-${input.callId}`,
        status: 'COMPLETED',
      },
    });
    const event = await prisma.callEvent.create({
      data: {
        callId: otherCall.id,
        eventType: 'webhook.call.ended',
        data: { transcript: { text: input.request.sources[0]!.text, turns: null } },
      },
    });
    const wrongSource = structuredClone(input.request);
    wrongSource.sources[0]!.id = `transcript.${event.id}`;
    expect(await input.gateway.generate(wrongSource)).toMatchObject({
      status: 'FAILED',
      code: 'INVALID_REQUEST',
    });
    expect(input.sends()).toBe(0);
    expect(
      await prisma.inferenceRun.count({
        where: { organizationId: input.request.organizationId },
      }),
    ).toBe(0);
  });

  it('rejects final transcript changes before publication of a saved response', async () => {
    const input = await fixture();
    expect((await input.gateway.generate(input.request)).status).toBe('VALIDATED');
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { organizationId: input.request.organizationId, callId: input.callId },
    });
    await prisma.callEvent.updateMany({
      where: { callId: input.callId, call: { organizationId: input.request.organizationId } },
      data: { data: { transcript: { text: 'A different final transcript.', turns: null } } },
    });
    await expect(
      publishStoredObservation({
        prisma,
        organizationId: input.request.organizationId,
        runId: run.id,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INFERENCE_RESULT' });
    expect(input.sends()).toBe(1);
    expect(
      await prisma.claimObservation.count({
        where: { organizationId: input.request.organizationId },
      }),
    ).toBe(0);
  });

  it('requires the latest final transcript for new inference instead of an older final snapshot', async () => {
    const input = await fixture();
    await prisma.callEvent.create({
      data: {
        callId: input.callId,
        eventType: 'webhook.call.ended',
        timestamp: new Date(Date.now() + 1000),
        data: { transcript: { text: 'A corrected final transcript.', turns: null } },
      },
    });
    expect(await input.gateway.generate(input.request)).toMatchObject({
      status: 'FAILED',
      code: 'INVALID_REQUEST',
    });
    expect(input.sends()).toBe(0);
  });

  it('rejects a provisional transcript even when its source label and content hash match', async () => {
    const input = await fixture();
    await prisma.callEvent.updateMany({
      where: { callId: input.callId, call: { organizationId: input.request.organizationId } },
      data: { eventType: 'webhook.call.transcript_snapshot' },
    });
    expect(await input.gateway.generate(input.request)).toMatchObject({
      status: 'FAILED',
      code: 'INVALID_REQUEST',
    });
    expect(input.sends()).toBe(0);
  });
});
