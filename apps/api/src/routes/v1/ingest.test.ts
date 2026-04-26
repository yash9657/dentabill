import type { Organization } from '@dentabill/db';
import { prisma } from '@dentabill/db';
import type { FastifyInstance } from 'fastify';
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

const DENTRIX_CSV = `Patient ID,Patient Name,DOB,Insurance Carrier,Claim #,Procedure Codes,Charge,Service Date,Submission Date,Status
P0001,"Sample, A",1990-05-12,Delta Dental PPO,CL-1,D2740,1240.00,2026-01-08,2026-01-09,Submitted
P0002,"Sample, B",1985-11-30,Cigna Dental,CL-2,D0150,215.50,not-a-date,,Pending
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
      'TRUNCATE TABLE "Organization", "User", "Claim", "Call", "CallSummary", "CallEvent", "PayerConfig", "AuditLog" RESTART IDENTITY CASCADE',
    );
  });

  it('rejects unauthenticated upload with 401', async () => {
    const { body, contentType } = multipartBody({ content: DENTRIX_CSV });
    const response = await server.inject({
      method: 'POST',
      url: '/v1/ingest/claims',
      headers: { 'content-type': contentType },
      payload: body,
    });
    expect(response.statusCode).toBe(401);
  });

  it('parses, inserts the valid rows, and returns counts', async () => {
    const org = await makeOrg('IngestAcme');
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
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

  it('skips duplicate rows on re-upload (idempotency by claimNumber)', async () => {
    const org = await makeOrg('IngestDedupe');
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
    const VALID_CSV = `Patient ID,Patient Name,DOB,Insurance Carrier,Claim #,Procedure Codes,Charge,Service Date,Submission Date,Status
P1,"Sample",1990-05-12,Delta Dental PPO,CL-DUP,D2740,1240.00,2026-01-08,2026-01-09,Submitted
P2,"Sample",1985-11-30,Cigna Dental,CL-NEW,D0150,215.50,2026-01-12,2026-01-13,Submitted
`;
    const PARTIAL_OVERLAP_CSV = `Patient ID,Patient Name,DOB,Insurance Carrier,Claim #,Procedure Codes,Charge,Service Date,Submission Date,Status
P1,"Sample",1990-05-12,Delta Dental PPO,CL-DUP,D2740,1240.00,2026-01-08,2026-01-09,Submitted
P3,"Sample",2001-07-22,MetLife Dental,CL-FRESH,D2950,485.00,2026-01-15,2026-01-16,Submitted
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
    const headersA = { 'x-test-user-id': 'user_a', 'x-test-org-id': orgA.id };
    const headersB = { 'x-test-user-id': 'user_b', 'x-test-org-id': orgB.id };
    const csv = `Patient ID,Patient Name,DOB,Insurance Carrier,Claim #,Procedure Codes,Charge,Service Date,Submission Date,Status
P1,"Sample",1990-05-12,Delta Dental PPO,CL-X,D2740,1240.00,2026-01-08,2026-01-09,Submitted
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
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
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
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
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
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
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
    const headers = { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id };
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
});
