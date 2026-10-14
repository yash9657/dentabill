import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { prisma } from '@dentabill/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildServer } from '../../app.js';
import { CashEvidenceSchema, CashPreviewSchema } from '../cash-evidence/contract.js';
import {
  CashMatchListSchema,
  CashMatchReceiptSchema,
  MatchPreviewSchema,
  ReleasePreviewSchema,
  ReleaseReceiptSchema,
} from '../cash-reconciliation/contract.js';
import { initEnv } from '../env.js';
import { PostingEvidenceSchema, PostingPreviewSchema } from '../posting-evidence/contract.js';
import {
  RelationshipListSchema,
  RelationshipPreviewSchema,
  RelationshipReceiptSchema,
  RelationshipTargetsSchema,
} from '../posting-relationships/contract.js';
import { BatchEvidenceSchema, BatchPreviewSchema } from '../remittance-batches/contract.js';
import {
  EvidenceResponseSchema,
  ListResponseSchema,
  PreviewResponseSchema,
} from '../remittances/contract.js';

import { verifyDemoBundle } from './bundle.js';

const published = fileURLToPath(new URL('../../../../web/public/examples/demo/', import.meta.url));
const ImportReport = z.object({
  insertedRows: z.number(),
  rows: z.array(z.object({ claimId: z.string().nullable() })),
});

describe('published demo bundle through real API and Postgres', { timeout: 30000 }, () => {
  let app: FastifyInstance;
  let admittedDatabase = false;
  let appInitialized = false;
  let organizationId: string;
  let headers: Record<string, string>;
  let ordinal = 0;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !['/dentabill_test', '/dentabill_w0_identity'].includes(url.pathname)
    )
      throw new Error('Demo flow proof requires an isolated local DentaBill test database.');
    admittedDatabase = true;
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    initEnv();
    app = await buildServer({ logger: false });
    appInitialized = true;
    organizationId = (
      await prisma.organization.create({
        data: { name: 'Synthetic demo bundle API proof', clerkOrgId: `org_${randomUUID()}` },
      })
    ).id;
    const user = await prisma.user.create({
      data: {
        organizationId,
        clerkUserId: `user_${randomUUID()}`,
        email: 'synthetic-demo@example.test',
        role: 'OWNER',
      },
    });
    headers = { 'x-test-user-id': user.clerkUserId };
  }, 30000);
  afterAll(async () => {
    if (!admittedDatabase) return;
    try {
      if (appInitialized) {
        await app.close();
        await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organization" RESTART IDENTITY CASCADE');
      }
    } finally {
      await prisma.$disconnect();
    }
  }, 30000);

  async function request<T>(
    method: 'GET' | 'POST',
    url: string,
    schema: z.ZodType<T>,
    payload?: unknown,
    status = 200,
  ): Promise<T> {
    ordinal += 1;
    const result = await app.inject({
      method,
      url,
      headers: {
        ...headers,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
      remoteAddress: `2001:db8::${ordinal.toString(16)}`,
    });
    expect(result.statusCode, result.body).toBe(status);
    return schema.parse(result.json());
  }
  async function approved<
    T extends { id: string },
    P extends { reviewToken: string; blockers: readonly string[] },
  >(base: string, payload: unknown, evidence: z.ZodType<T>, preview: z.ZodType<P>): Promise<T> {
    const imported = await request('POST', base, evidence, payload, 201);
    const p = await request('GET', `${base}/${imported.id}/preview`, preview);
    expect(p.blockers).toEqual([]);
    return request('POST', `${base}/${imported.id}/review`, evidence, {
      decision: 'ACCEPT',
      reviewToken: p.reviewToken,
      idempotencyKey: randomUUID(),
    });
  }

  it('imports, reviews, matches100+50, associates posting entries and explicitly releases stale correction reservations', async () => {
    const bundle = await verifyDemoBundle(published);
    const boundary = '----DentaBillSyntheticDemoBundle';
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed published synthetic fixture
    const csv = await readFile(
      new URL('../../../../web/public/examples/demo/claims.csv', import.meta.url),
    );
    const result = await app.inject({
      method: 'POST',
      url: '/v1/ingest/claims',
      headers: {
        ...headers,
        'x-import-source': bundle.manifest.sourceNamespace,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="claims.csv"\r\nContent-Type: text/csv\r\n\r\n`,
        ),
        csv,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(ImportReport.parse(result.json()).insertedRows).toBe(2);
    const claims = await prisma.claim.findMany({
      where: { organizationId },
      orderBy: { sourceClaimId: 'asc' },
      include: { sourceDetails: { include: { lines: true } } },
    });
    expect(claims.map((claim) => claim.sourceClaimId)).toEqual(
      bundle.manifest.claims.map((claim) => claim.sourceClaimId),
    );
    expect(
      claims.every(
        (claim) => claim.sourceContentHash !== null && claim.sourceDetails?.lines.length === 1,
      ),
    ).toBe(true);
    const claimSnapshot = await prisma.claim.findMany({
      where: { organizationId },
      orderBy: { id: 'asc' },
    });
    const sources = await prisma.claimSourceLine.findMany({
      where: { organizationId },
      orderBy: { id: 'asc' },
    });
    for (const remit of bundle.remittances) {
      const claim = claims.find((row) => row.sourceClaimId === remit.sourceClaimId)!;
      const base = `/v1/claims/${claim.id}/remittances`;
      await approved(base, remit.input, EvidenceResponseSchema, PreviewResponseSchema);
      const listed = await request('GET', base, ListResponseSchema);
      expect(listed.summary).toMatchObject({
        reviewedReportedAmount: remit.input.reportedAmount,
        cashReceipt: 'UNVERIFIED',
        posting: 'UNVERIFIED',
        settlement: 'UNVERIFIED',
      });
    }
    const batch = await approved(
      '/v1/remittance-batches',
      bundle.batch,
      BatchEvidenceSchema,
      BatchPreviewSchema,
    );
    const cash = await approved(
      '/v1/cash-evidence',
      bundle.cash,
      CashEvidenceSchema,
      CashPreviewSchema,
    );
    const match = async (batchEvidenceId: string, amount: string) => {
      const candidate = { cashEvidenceId: cash.id, batchEvidenceId, amount };
      const preview = await request(
        'POST',
        '/v1/cash-reconciliations/preview',
        MatchPreviewSchema,
        candidate,
      );
      expect(preview.blockers).toEqual([]);
      expect(preview).toMatchObject({
        bankVerification: 'UNVERIFIED',
        settlement: 'UNVERIFIED',
        claimCashAllocation: 'UNALLOCATED',
      });
      const command = {
        ...candidate,
        reviewToken: preview.reviewToken,
        idempotencyKey: randomUUID(),
      };
      const receipt = await request(
        'POST',
        '/v1/cash-reconciliations',
        CashMatchReceiptSchema,
        command,
        201,
      );
      return { receipt, command };
    };
    const first = await match(batch.id, '100.00');
    const afterFirst = await request(
      'POST',
      '/v1/cash-reconciliations/preview',
      MatchPreviewSchema,
      { cashEvidenceId: cash.id, batchEvidenceId: batch.id, amount: '50.00' },
    );
    expect(afterFirst.capacity).toMatchObject({
      cashReservedMagnitude: '100.00',
      cashAvailableMagnitude: '50.00',
      batchReservedMagnitude: '100.00',
      batchAvailableMagnitude: '50.00',
    });
    const second = await match(batch.id, '50.00');
    const full = await request('POST', '/v1/cash-reconciliations/preview', MatchPreviewSchema, {
      cashEvidenceId: cash.id,
      batchEvidenceId: batch.id,
      amount: '1.00',
    });
    expect(full.blockers).toEqual(
      expect.arrayContaining(['CASH_CAPACITY_EXCEEDED', 'BATCH_CAPACITY_EXCEEDED']),
    );
    const posting = await approved(
      '/v1/posting-evidence',
      bundle.posting,
      PostingEvidenceSchema,
      PostingPreviewSchema,
    );
    expect(posting.totals).toMatchObject({
      knownListedEntryAmount: '180.00',
      headerDifference: '-30.00',
    });
    const targets = await request(
      'GET',
      `/v1/posting-evidence/${posting.id}/relationship-targets`,
      RelationshipTargetsSchema,
    );
    expect(targets.items).toHaveLength(2);
    expect(targets.items[0]?.candidate?.claimSourceLineId).toBe(
      claims[0]?.sourceDetails?.lines[0]?.id,
    );
    expect(targets.items[1]?.candidate?.claimSourceLineId).toBeNull();
    for (const target of targets.items) {
      expect(target.blockers).toEqual([]);
      expect(target.candidate).not.toBeNull();
      const p = await request(
        'POST',
        '/v1/posting-relationships/preview',
        RelationshipPreviewSchema,
        target.candidate,
      );
      await request(
        'POST',
        '/v1/posting-relationships',
        RelationshipReceiptSchema,
        { ...target.candidate, reviewToken: p.reviewToken, idempotencyKey: randomUUID() },
        201,
      );
    }
    for (const row of (await request('GET', '/v1/posting-relationships', RelationshipListSchema))
      .items)
      expect(row).toMatchObject({
        status: 'CURRENT',
        bankVerification: 'UNVERIFIED',
        claimCashAllocation: 'UNALLOCATED',
      });
    const corrected = await approved(
      '/v1/remittance-batches',
      bundle.batchCorrection,
      BatchEvidenceSchema,
      BatchPreviewSchema,
    );
    expect(corrected.revision.batchId).toBe(batch.revision.batchId);
    const stale = await request('GET', '/v1/cash-reconciliations', CashMatchListSchema);
    expect(stale.items).toHaveLength(2);
    expect(stale.items.every((row) => row.status === 'STALE' && row.release === null)).toBe(true);
    const correctedCandidate = {
      cashEvidenceId: cash.id,
      batchEvidenceId: corrected.id,
      amount: '140.00',
    };
    const blocked = await request(
      'POST',
      '/v1/cash-reconciliations/preview',
      MatchPreviewSchema,
      correctedCandidate,
    );
    expect(blocked.blockers).toContain('STALE_BATCH_RESERVATION');
    expect(blocked.capacity.batchReservedMagnitude).toBe('150.00');
    for (const saved of [first, second]) {
      const base = `/v1/cash-reconciliations/${saved.receipt.id}/release`;
      const p = await request('POST', `${base}/preview`, ReleasePreviewSchema, {
        reason: 'SOURCE_CHANGED',
      });
      expect(p.canRelease).toBe(true);
      await request(
        'POST',
        base,
        ReleaseReceiptSchema,
        { reason: 'SOURCE_CHANGED', reviewToken: p.reviewToken, idempotencyKey: randomUUID() },
        201,
      );
    }
    await match(corrected.id, '140.00');
    const remaining = await request(
      'POST',
      '/v1/cash-reconciliations/preview',
      MatchPreviewSchema,
      { ...correctedCandidate, amount: '1.00' },
    );
    expect(remaining.capacity).toMatchObject({
      cashAvailableMagnitude: '10.00',
      batchAvailableMagnitude: '0.00',
    });
    expect(
      await request('POST', '/v1/cash-reconciliations', CashMatchReceiptSchema, first.command),
    ).toEqual(first.receipt);
    expect(
      await prisma.claim.findMany({ where: { organizationId }, orderBy: { id: 'asc' } }),
    ).toEqual(claimSnapshot);
    expect(
      await prisma.claimSourceLine.findMany({ where: { organizationId }, orderBy: { id: 'asc' } }),
    ).toEqual(sources);
    expect(await prisma.billingUsageRecord.count({ where: { organizationId } })).toBe(0);
    expect(await prisma.call.count({ where: { organizationId } })).toBe(0);
    expect(await prisma.inferenceRun.count({ where: { organizationId } })).toBe(0);
  });
});
