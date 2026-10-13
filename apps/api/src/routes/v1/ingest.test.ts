/* eslint-disable security/detect-non-literal-fs-filename -- Only checked-in synthetic fixtures resolved relative to this test. */
import { readFileSync } from 'node:fs';

import type { Organization } from '@dentabill/db';
import { prisma } from '@dentabill/db';
import type { FastifyInstance } from 'fastify';
import Papa from 'papaparse';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';

/**
 * `/v1/ingest/claims` integration tests.
 *
 * The endpoint is wired against the same test-header auth bypass as
 * `/v1/claims`, so each test seeds an Organization and injects
 * `x-test-user-id` + `x-test-org-id` instead of a real Clerk JWT.
 *
 * The multipart body is constructed by hand (no `form-data` dep) to
 * keep the test surface small and deterministic.
 */
async function makeOrg(name: string): Promise<Organization> {
  return prisma.organization.create({
    data: { name, clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}` },
  });
}

const BOUNDARY = '----DentaBillTestBoundary12345';

function multipartBody(opts: {
  readonly fieldName?: string;
  readonly filename?: string;
  readonly contentType?: string;
  readonly content: string | Buffer;
}): { readonly body: Buffer; readonly contentType: string } {
  const fieldName = opts.fieldName ?? 'file';
  const filename = opts.filename ?? 'upload.csv';
  const contentType = opts.contentType ?? 'text/csv';
  const head = Buffer.from(
    `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`, 'utf8');
  const content =
    typeof opts.content === 'string' ? Buffer.from(opts.content, 'utf8') : opts.content;
  return {
    body: Buffer.concat([head, content, tail]),
    contentType: `multipart/form-data; boundary=${BOUNDARY}`,
  };
}

const DENTRIX_CSV = `Patient ID,Patient Name,DOB,Insurance Carrier,Claim #,Procedure Codes,Charge,Service Date,Submission Date,Status,SourceClaimId
P0001,"Sample, A",1990-05-12,Delta Dental PPO,CL-1,D2740,1240.00,2026-01-08,2026-01-09,Submitted,record-one
P0002,"Sample, B",1985-11-30,Cigna Dental,CL-2,D0150,215.50,not-a-date,,Pending,record-two
`;

describe('/v1/ingest/claims (integration)', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    server = await buildServer({ logger: false });
    await prisma.$connect();
  });

  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Organization", "User", "Claim", "Call", "CallSummary", "CallEvent", "PayerConfig", "AuditLog", "BillingUsageRecord" RESTART IDENTITY CASCADE',
    );
  });

  it('uploads explicit source details and serves the saved procedures and coverage through claim detail', async () => {
    const org = await makeOrg('SyntheticDetail');
    const fixture = readFileSync(
      new URL(
        '../../../test/fixtures/csv/opendental-source-details-synthetic.csv',
        import.meta.url,
      ),
    );
    const { body, contentType } = multipartBody({ content: fixture });
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
    const uploaded = await server.inject({
      method: 'POST',
      url: '/v1/ingest/claims',
      headers: { ...headers, 'x-import-source': 'synthetic-main', 'content-type': contentType },
      payload: body,
    });
    expect(uploaded.statusCode).toBe(200);
    const report = uploaded.json<{ insertedRows: number; rows: { claimId: string }[] }>();
    expect(report.insertedRows).toBe(1);
    const claimId = report.rows[0]?.claimId;
    if (!claimId) throw new Error('Missing synthetic claim');
    const detail = await server.inject({ method: 'GET', url: `/v1/claims/${claimId}`, headers });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      status: 'PENDING',
      claimAmount: '100',
      sourceDetails: {
        importedClaimAmount: '100.00',
        sourceNamespace: 'synthetic-main',
        sourceVersion: 'version-1',
        lines: [
          { sourceLineId: 'proc-line-01', tooth: 'A', quantity: '3.000', billedAmount: '40.00' },
          { sourceLineId: 'proc-line-02', tooth: 'AS', quantity: null, billedAmount: '60.00' },
        ],
        coverages: [
          { sequence: 1, isClaimCoverage: false },
          { sequence: 2, isClaimCoverage: true, subscriberId: null },
        ],
      },
    });
    const replay = await server.inject({
      method: 'POST',
      url: '/v1/ingest/claims',
      headers: { ...headers, 'x-import-source': 'synthetic-main', 'content-type': contentType },
      payload: body,
    });
    expect(replay.json()).toMatchObject({ insertedRows: 0, skippedDuplicates: 1 });
    expect(await prisma.claimSourceLine.count({ where: { organizationId: org.id } })).toBe(2);
  });

  it('reports contradictory child facts without importing a summary-only claim', async () => {
    const org = await makeOrg('SyntheticInvalidDetail');
    const fixture = readFileSync(
      new URL(
        '../../../test/fixtures/csv/opendental-source-details-synthetic.csv',
        import.meta.url,
      ),
      'utf8',
    ).replace('40.00', '39.99');
    const { body, contentType } = multipartBody({ content: fixture });
    const response = await server.inject({
      method: 'POST',
      url: '/v1/ingest/claims',
      headers: {
        'x-test-user-id': 'user_a',
        'x-test-org-id': org.id,
        'x-import-source': 'synthetic-main',
        'content-type': contentType,
      },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      insertedRows: 0,
      validRows: 0,
      errors: [{ rowIndex: 2, message: 'ClaimLines: billed amounts must sum to the claim amount' }],
    });
    expect(await prisma.claim.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it('rejects the upload-wide child limit before writing any claims', async () => {
    const org = await makeOrg('SyntheticChildLimit');
    const lines = JSON.stringify(
      Array.from({ length: 500 }, (_, index) => ({
        sourceLineId: String(index),
        procedureCode: 'D1110',
        serviceDate: '2026-01-08',
        billedAmount: '0.00',
      })),
    );
    const content = Papa.unparse(
      Array.from({ length: 21 }, (_, index) => ({
        PatNum: 'synthetic',
        Birthdate: '1990-05-12',
        InsCarrier: 'Synthetic',
        ClaimIdent: String(index),
        ClaimNum: String(index),
        ProcCodes: 'D1110',
        ClaimFee: '0.00',
        ProcDate: '2026-01-08',
        ClaimLines: lines,
      })),
    );
    const { body, contentType } = multipartBody({ content });
    const response = await server.inject({
      method: 'POST',
      url: '/v1/ingest/claims',
      headers: {
        'x-test-user-id': 'user_a',
        'x-test-org-id': org.id,
        'x-import-source': 'synthetic-main',
        'content-type': contentType,
      },
      payload: body,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('10000'),
    });
    expect(await prisma.claim.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it('rejects unauthenticated upload with 401', async () => {
    const { body, contentType } = multipartBody({ content: DENTRIX_CSV });
    const response = await server.inject({
      method: 'POST',
      url: '/v1/ingest/claims',
      headers: { 'x-import-source': 'practice-main', 'content-type': contentType },
      payload: body,
    });
    expect(response.statusCode).toBe(401);
  });

  it('parses, inserts the valid rows, and returns counts', async () => {
    const org = await makeOrg('IngestAcme');
    const headers = {
      'x-import-source': 'practice-main',
      'x-test-user-id': 'user_a',
      'x-test-org-id': org.id,
    };
    const { body, contentType } = multipartBody({ content: DENTRIX_CSV });
    const response = await server.inject({
      method: 'POST',
      url: '/v1/ingest/claims',
      headers: { ...headers, 'content-type': contentType },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    const json = response.json<{
      source: string;
      totalRows: number;
      validRows: number;
      insertedRows: number;
      skippedDuplicates: number;
      errors: { rowIndex: number; message: string }[];
    }>();
    expect(json.source).toBe('DENTRIX');
    expect(json.totalRows).toBe(2);
    expect(json.validRows).toBe(1);
    expect(json.insertedRows).toBe(1);
    expect(json.skippedDuplicates).toBe(0);
    expect(json.errors).toHaveLength(1);
    expect(json.errors[0]?.message).toMatch(/serviceDate/);

    // Verify the inserted row landed in the DB with hashed DOB +
    // computed priority + canonical payer code.
    const persisted = await prisma.claim.findFirst({
      where: { organizationId: org.id, claimNumber: 'CL-1' },
    });
    expect(persisted).not.toBeNull();
    expect(persisted?.payerCode).toBe('DELTA_DENTAL_PPO');
    expect(persisted?.patientDOBHash).toMatch(/^[0-9a-f]{64}$/);
    expect(persisted?.patientDOBLast4).toBe('1990');
    expect(persisted?.priority).toBeGreaterThan(0);
  });

  it('skips duplicate rows on re-upload (idempotency by explicit source identity)', async () => {
    const org = await makeOrg('IngestDedupe');
    const headers = {
      'x-import-source': 'practice-main',
      'x-test-user-id': 'user_a',
      'x-test-org-id': org.id,
    };
    const VALID_CSV = `Patient ID,Patient Name,DOB,Insurance Carrier,Claim #,Procedure Codes,Charge,Service Date,Submission Date,Status,SourceClaimId
P1,"Sample",1990-05-12,Delta Dental PPO,CL-DUP,D2740,1240.00,2026-01-08,2026-01-09,Submitted,record-duplicate
P2,"Sample",1985-11-30,Cigna Dental,CL-NEW,D0150,215.50,2026-01-12,2026-01-13,Submitted,record-new
`;
    const PARTIAL_OVERLAP_CSV = `Patient ID,Patient Name,DOB,Insurance Carrier,Claim #,Procedure Codes,Charge,Service Date,Submission Date,Status,SourceClaimId
P1,"Sample",1990-05-12,Delta Dental PPO,CL-DUP,D2740,1240.00,2026-01-08,2026-01-09,Submitted,record-duplicate
P3,"Sample",2001-07-22,MetLife Dental,CL-FRESH,D2950,485.00,2026-01-15,2026-01-16,Submitted,record-fresh
`;
    const send = async (
      csv: string,
    ): Promise<{
      insertedRows: number;
      skippedDuplicates: number;
    }> => {
      const { body, contentType } = multipartBody({ content: csv });
      const response = await server.inject({
        method: 'POST',
        url: '/v1/ingest/claims',
        headers: { ...headers, 'content-type': contentType },
        payload: body,
      });
      expect(response.statusCode).toBe(200);
      return response.json<{ insertedRows: number; skippedDuplicates: number }>();
    };

    const first = await send(VALID_CSV);
    expect(first.insertedRows).toBe(2);
    expect(first.skippedDuplicates).toBe(0);

    const second = await send(PARTIAL_OVERLAP_CSV);
    expect(second.insertedRows).toBe(1);
    expect(second.skippedDuplicates).toBe(1);

    const total = await prisma.claim.count({ where: { organizationId: org.id } });
    expect(total).toBe(3); // CL-DUP + CL-NEW + CL-FRESH
  });

  it('isolates uploads between organizations (cross-org leak guard)', async () => {
    const orgA = await makeOrg('IngestA');
    const orgB = await makeOrg('IngestB');
    const headersA = {
      'x-import-source': 'practice-main',
      'x-test-user-id': 'user_a',
      'x-test-org-id': orgA.id,
    };
    const headersB = {
      'x-import-source': 'practice-main',
      'x-test-user-id': 'user_b',
      'x-test-org-id': orgB.id,
    };
    const csv = `Patient ID,Patient Name,DOB,Insurance Carrier,Claim #,Procedure Codes,Charge,Service Date,Submission Date,Status,SourceClaimId
P1,"Sample",1990-05-12,Delta Dental PPO,CL-X,D2740,1240.00,2026-01-08,2026-01-09,Submitted,record-shared
`;
    const send = async (h: typeof headersA): Promise<void> => {
      const { body, contentType } = multipartBody({ content: csv });
      const response = await server.inject({
        method: 'POST',
        url: '/v1/ingest/claims',
        headers: { ...h, 'content-type': contentType },
        payload: body,
      });
      expect(response.statusCode).toBe(200);
    };

    await send(headersA);
    await send(headersB);

    // Same claim number; both orgs should have their own row.
    const aRows = await prisma.claim.findMany({ where: { organizationId: orgA.id } });
    const bRows = await prisma.claim.findMany({ where: { organizationId: orgB.id } });
    expect(aRows).toHaveLength(1);
    expect(bRows).toHaveLength(1);
    // The DOB hash MUST differ across orgs (per ADR-007 — no
    // global rainbow table risk).
    expect(aRows[0]?.patientDOBHash).not.toBe(bRows[0]?.patientDOBHash);
  });

  it('rejects an unknown CSV format with 400 VALIDATION_ERROR', async () => {
    const org = await makeOrg('IngestUnknown');
    const headers = {
      'x-import-source': 'practice-main',
      'x-test-user-id': 'user_a',
      'x-test-org-id': org.id,
    };
    const csv = 'foo,bar,baz\n1,2,3\n';
    const { body, contentType } = multipartBody({ content: csv });
    const response = await server.inject({
      method: 'POST',
      url: '/v1/ingest/claims',
      headers: { ...headers, 'content-type': contentType },
      payload: body,
    });
    expect(response.statusCode).toBe(400);
    const json = response.json<{ code?: string; message?: string }>();
    expect(json.code).toBe('VALIDATION_ERROR');
    expect(json.message).toMatch(/unrecognised/i);
  });

  it('rejects a non-CSV upload (no commas in first line)', async () => {
    const org = await makeOrg('IngestNoCsv');
    const headers = {
      'x-import-source': 'practice-main',
      'x-test-user-id': 'user_a',
      'x-test-org-id': org.id,
    };
    const { body, contentType } = multipartBody({
      filename: 'plain.txt',
      contentType: 'text/plain',
      content: 'this is just text without commas\n',
    });
    const response = await server.inject({
      method: 'POST',
      url: '/v1/ingest/claims',
      headers: { ...headers, 'content-type': contentType },
      payload: body,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code?: string }>().code).toBe('VALIDATION_ERROR');
  });

  it('rejects a binary upload', async () => {
    const org = await makeOrg('IngestBin');
    const headers = {
      'x-import-source': 'practice-main',
      'x-test-user-id': 'user_a',
      'x-test-org-id': org.id,
    };
    const binary = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
    const { body, contentType } = multipartBody({
      filename: 'sneaky.xlsx',
      contentType: 'application/octet-stream',
      content: binary,
    });
    const response = await server.inject({
      method: 'POST',
      url: '/v1/ingest/claims',
      headers: { ...headers, 'content-type': contentType },
      payload: body,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code?: string }>().code).toBe('VALIDATION_ERROR');
  });

  it('rejects a request with no file field', async () => {
    const org = await makeOrg('IngestNoFile');
    const headers = {
      'x-import-source': 'practice-main',
      'x-test-user-id': 'user_a',
      'x-test-org-id': org.id,
    };
    const empty = Buffer.from(`--${BOUNDARY}--\r\n`, 'utf8');
    const response = await server.inject({
      method: 'POST',
      url: '/v1/ingest/claims',
      headers: {
        ...headers,
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      },
      payload: empty,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code?: string }>().code).toBe('VALIDATION_ERROR');
  });
  it('requires an explicit valid source database before writing', async () => {
    const org = await makeOrg('MissingSource');
    const { body, contentType } = multipartBody({ content: DENTRIX_CSV });
    for (const namespace of [undefined, '', 'Practice Main', 'other/org', 'a'.repeat(81)]) {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/ingest/claims',
        headers: {
          'x-test-user-id': 'user_a',
          'x-test-org-id': org.id,
          'content-type': contentType,
          ...(namespace === undefined ? {} : { 'x-import-source': namespace }),
        },
        payload: body,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(await prisma.claim.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it('exposes actionable row dispositions through the HTTP contract', async () => {
    const org = await makeOrg('RowReports');
    const send = async (
      csv: string,
    ): Promise<
      ReturnType<typeof multipartBody> & { response: Awaited<ReturnType<typeof server.inject>> }
    > => {
      const part = multipartBody({ content: csv });
      const response = await server.inject({
        method: 'POST',
        url: '/v1/ingest/claims',
        headers: {
          'x-test-user-id': 'user_a',
          'x-test-org-id': org.id,
          'x-import-source': 'practice-main',
          'content-type': part.contentType,
        },
        payload: part.body,
      });
      return { ...part, response };
    };
    const first = await send(DENTRIX_CSV);
    expect(first.response.statusCode).toBe(200);
    const inserted = first.response.json<{ rows: { claimId: string }[] }>().rows[0]?.claimId;
    const changed = await send(DENTRIX_CSV.replace('1240.00', '1200.00'));
    expect(changed.response.json()).toMatchObject({
      sourceNamespace: 'practice-main',
      insertedRows: 0,
      skippedDuplicates: 0,
      conflictRows: 1,
      rows: [{ rowIndex: 2, disposition: 'SOURCE_CHANGED', claimId: inserted }],
    });
    const missing = await send(DENTRIX_CSV.replace(',record-one', ','));
    expect(missing.response.json()).toMatchObject({
      insertedRows: 0,
      conflictRows: 1,
      rows: [{ rowIndex: 2, disposition: 'MISSING_SOURCE_ID', claimId: null }],
    });
    expect(await prisma.claim.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it('rejects extra multipart fields before importing the first file', async () => {
    const org = await makeOrg('ExtraField');
    const part = multipartBody({ content: DENTRIX_CSV });
    const payload = part.body
      .toString()
      .replace(
        `--${BOUNDARY}--`,
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="extra"\r\n\r\nignored\r\n--${BOUNDARY}--`,
      );
    const response = await server.inject({
      method: 'POST',
      url: '/v1/ingest/claims',
      headers: {
        'x-test-user-id': 'user_a',
        'x-test-org-id': org.id,
        'x-import-source': 'practice-main',
        'content-type': part.contentType,
      },
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(await prisma.claim.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it('supports browser preflight for the source database header', async () => {
    const response = await server.inject({
      method: 'OPTIONS',
      url: '/v1/ingest/claims',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type,x-import-source',
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-headers']).toContain('x-import-source');
  });

  it('rejects a file beyond the bounded record limit before inserting anything', async () => {
    const org = await makeOrg('Limit');
    const [header = '', row = ''] = DENTRIX_CSV.split('\n');
    const part = multipartBody({
      content: `${header}\n${Array.from({ length: 5001 }, () => row).join('\n')}`,
    });
    const response = await server.inject({
      method: 'POST',
      url: '/v1/ingest/claims',
      headers: {
        'x-test-user-id': 'user_a',
        'x-test-org-id': org.id,
        'x-import-source': 'practice-main',
        'content-type': part.contentType,
      },
      payload: part.body,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ message: string }>().message).toMatch(/5,?000/);
    expect(await prisma.claim.count({ where: { organizationId: org.id } })).toBe(0);
  });
});
