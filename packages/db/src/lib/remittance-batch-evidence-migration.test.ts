/* eslint-disable security/detect-non-literal-fs-filename -- Paths are repository migration fixtures and a private generated test directory. */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

describe('remittance batch evidence migration', () => {
  it('preserves existing claims, source details, accepted remittances, cash evidence and helper definitions without inventing batches', async () => {
    const databaseUrl = process.env.DATABASE_URL;
    const url = new URL(databaseUrl ?? '');
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.pathname.startsWith('/dentabill_')
    )
      throw new Error('LOCAL_TEST_DATABASE_REQUIRED');
    const directory = await mkdtemp(join(tmpdir(), 'dentabill-batch-migration-'));
    const schema = `batch_evidence_proof_${randomUUID().replaceAll('-', '')}`;
    const migrations = resolve(import.meta.dirname, '../../prisma/migrations');
    const target = '20261014060000_remittance_batch_evidence';
    const prior = (await readdir(migrations))
      .filter((name) => name < target && /^\d/.test(name))
      .sort();
    const priorSql = await Promise.all(
      prior.map((name) => readFile(join(migrations, name, 'migration.sql'), 'utf8')),
    );
    const targetSql = await readFile(join(migrations, target, 'migration.sql'), 'utf8');
    const script = `BEGIN;
CREATE SCHEMA "${schema}";
SET LOCAL search_path TO "${schema}";
${priorSql.map((sql) => sql.replace(/^BEGIN;\r?$/gm, '').replace(/^COMMIT;\r?$/gm, '')).join('\n')}
INSERT INTO "Organization" (id, "clerkOrgId", name, "updatedAt") VALUES ('org', 'clerk', 'Synthetic', NOW());
INSERT INTO "Claim" (id, "organizationId", "patientDOBHash", "claimNumber", "claimAmount", "payerCode", "serviceDate", status, "updatedAt")
VALUES ('legacy', 'org', 'synthetic1', 'same-display', 100, 'UNKNOWN', '2026-01-01', 'APPEALING', '2026-01-02');
INSERT INTO "Claim" (id, "organizationId", "patientDOBHash", "claimNumber", "claimAmount", "payerCode", "serviceDate", status, "updatedAt", "sourceSystem", "sourceNamespace", "sourceClaimId", "sourceContentHash")
VALUES ('imported', 'org', 'synthetic2', 'same-display', 200, 'UNKNOWN', '2026-01-01', 'RESOLVED', '2026-01-03', 'OPEN_DENTAL', 'synthetic', '0001', repeat('a', 64));
INSERT INTO "ClaimSourceDetails" ("claimId", "organizationId", "importedClaimAmount", "lineCount", "coverageCount") VALUES ('imported', 'org', 200, 1, 0);
INSERT INTO "ClaimSourceLine" (id, "claimId", "organizationId", "sourceLineId", position, "procedureCode", "serviceDate", "billedAmount") VALUES ('00000000-0000-0000-0000-000000000001', 'imported', 'org', '000-line', 0, 'D2740', DATE '2026-01-01', 200);
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO "User" (id, "organizationId", "clerkUserId", email, role) VALUES ('reviewer', 'org', 'reviewer-clerk', 'synthetic@example.invalid', 'BILLING_STAFF');
INSERT INTO "ClaimRemittanceEvidence" (id, "organizationId", "claimId", "sourceNamespace", "sourceRecordId", "sourceDocumentId", kind, "reportedAmount", currency, payload, "contentHash")
VALUES ('00000000-0000-0000-0000-000000000010','org','imported','synthetic','remit-1','document-1','PAYMENT',100,'USD',
'{"schemaVersion":1,"sourceNamespace":"synthetic","sourceRecordId":"remit-1","sourceDocumentId":"document-1","sourceVersion":null,"kind":"PAYMENT","reversesSourceRecordId":null,"currency":"USD","reportedAmount":"100.00","payerName":"Synthetic payer","payerIdentifier":null,"payerIdentifierSystem":null,"payerClaimControlNumber":null,"sourceCoverageId":null,"paymentTrace":null,"paymentTraceType":null,"paymentTraceIssuer":null,"reportedDate":null,"sourceStatus":null,"lineDetailCompleteness":"ABSENT","allocations":[],"adjustments":[]}',repeat('a',64));
INSERT INTO "ClaimRemittanceReview" (id,"organizationId","claimId","evidenceId",decision,"reviewedByUserId","idempotencyKey","requestHash","reviewToken","evidenceHash","claimUpdatedAt","ledgerVersion","reportedAmount","allocationCount","adjustmentCount")
VALUES ('00000000-0000-0000-0000-000000000011','org','imported','00000000-0000-0000-0000-000000000010','ACCEPT','reviewer','00000000-0000-0000-0000-000000000012',repeat('b',64),repeat('c',64),repeat('a',64),'2026-01-03','1:0',100,0,0);
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO "CashSourceTransaction"
  (id,"organizationId","sourceSystem","sourceProduct","sourceNamespace","sourceAccountId","sourceTransactionId")
VALUES ('00000000-0000-4000-8000-000000000001','org',repeat(chr(128512),40),
  'Synthetic ordered export','synthetic-bank','000-account','000-transaction');
INSERT INTO "CashSourceEvidence"
  (id,"organizationId","transactionId","sourceNamespace","sourceAccountId","sourceRecordId",
   "sourceSequence","sourceVersion","sourceDocumentId",status,amount,payload,"contentHash")
VALUES ('00000000-0000-4000-8000-000000000002','org','00000000-0000-4000-8000-000000000001',
  'synthetic-bank','000-account','000-record',1,NULL,'synthetic-document','POSTED',100,
  jsonb_build_object(
    'schemaVersion',1,'evidenceBasis','BANK_ACCOUNT_TRANSACTION',
    'sourceSystem',repeat(chr(128512),40),'sourceProduct','Synthetic ordered export',
    'sourceNamespace','synthetic-bank','sourceAccountId','000-account','sourceTransactionId','000-transaction',
    'sourceRecordId','000-record','sourceSequence',1,'sourceVersion',NULL,'sourceDocumentId','synthetic-document',
    'observedAt','2026-01-02T12:00:00.000Z','status','POSTED','currency','USD',
    'amount','100.00','sourceAmount','100.00','sourceSignConvention','CREDIT_POSITIVE',
    'transactionDate','2026-01-01','postingDate','2026-01-02','counterpartyName',NULL,
    'paymentTrace',NULL,'sourceStatus',NULL,'sourceDescription',repeat(chr(128512),250),
    'pendingSourceTransactionId',NULL
  ),repeat('a',64));
INSERT INTO "CashSourceReview"
  (id,"organizationId","transactionId","evidenceId",decision,"reviewedByUserId","reviewedByRole",
   "idempotencyKey","requestHash","reviewToken","evidenceHash","ledgerVersion","previousAcceptedEvidenceId","sourceSequence")
VALUES ('00000000-0000-4000-8000-000000000003','org','00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002','ACCEPT','reviewer','BILLING_STAFF',
  '00000000-0000-4000-8000-000000000004',repeat('b',64),repeat('c',64),repeat('a',64),'1:0',NULL,1);

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
CREATE TEMP TABLE original_cash AS SELECT to_jsonb(c) AS payload FROM "CashSourceEvidence" c;
CREATE TEMP TABLE original_cash_transactions AS SELECT to_jsonb(c) AS payload FROM "CashSourceTransaction" c;
CREATE TEMP TABLE original_cash_reviews AS SELECT to_jsonb(c) AS payload FROM "CashSourceReview" c;
CREATE TEMP TABLE original_org AS SELECT to_jsonb(c) AS payload FROM "Organization" c;
CREATE TEMP TABLE original_helpers AS SELECT proname, pg_get_functiondef(oid) AS definition FROM pg_proc WHERE pronamespace = current_schema()::regnamespace;
CREATE TEMP TABLE original_evidence AS SELECT to_jsonb(c) AS payload FROM "ClaimRemittanceEvidence" c;
CREATE TEMP TABLE original_reviews AS SELECT to_jsonb(c) AS payload FROM "ClaimRemittanceReview" c;
CREATE TEMP TABLE original_claims AS SELECT to_jsonb(c) AS payload FROM "Claim" c;
CREATE TEMP TABLE original_details AS SELECT to_jsonb(c) AS payload FROM "ClaimSourceDetails" c;
CREATE TEMP TABLE original_lines AS SELECT to_jsonb(c) AS payload FROM "ClaimSourceLine" c;
${targetSql.replace(/^BEGIN;\r?$/gm, '').replace(/^COMMIT;\r?$/gm, '')}
DO $$ BEGIN
  IF (SELECT count(*) FROM "Claim") <> 2
    OR (SELECT count(*) FROM "CashSourceTransaction") <> 1
    OR (SELECT count(*) FROM "CashSourceEvidence") <> 1
    OR (SELECT count(*) FROM "CashSourceReview") <> 1
    OR (SELECT count(*) FROM "RemittanceBatchEvidence") <> 0
    OR (SELECT count(*) FROM "RemittanceBatchReview") <> 0
    OR (SELECT count(*) FROM "RemittanceBatchClaim") <> 0
    OR (SELECT count(*) FROM "RemittanceBatchAdjustment") <> 0
  THEN RAISE EXCEPTION 'Unexpected batch source backfill'; END IF;
  IF EXISTS (
    (SELECT payload FROM original_claims EXCEPT SELECT to_jsonb(c) FROM "Claim" c)
    UNION ALL
    (SELECT to_jsonb(c) FROM "Claim" c EXCEPT SELECT payload FROM original_claims)
  ) THEN RAISE EXCEPTION 'Existing claim payload changed'; END IF;
  IF EXISTS (
    (SELECT payload FROM original_details EXCEPT SELECT to_jsonb(c) FROM "ClaimSourceDetails" c)
    UNION ALL
    (SELECT to_jsonb(c) FROM "ClaimSourceDetails" c EXCEPT SELECT payload FROM original_details)
    UNION ALL
    (SELECT payload FROM original_lines EXCEPT SELECT to_jsonb(c) FROM "ClaimSourceLine" c)
    UNION ALL
    (SELECT to_jsonb(c) FROM "ClaimSourceLine" c EXCEPT SELECT payload FROM original_lines)
  ) THEN RAISE EXCEPTION 'Existing source snapshot changed'; END IF;
  IF EXISTS (
    (SELECT payload FROM original_evidence EXCEPT SELECT to_jsonb(c) FROM "ClaimRemittanceEvidence" c)
    UNION ALL
    (SELECT to_jsonb(c) FROM "ClaimRemittanceEvidence" c EXCEPT SELECT payload FROM original_evidence)
    UNION ALL
    (SELECT payload FROM original_reviews EXCEPT SELECT to_jsonb(c) FROM "ClaimRemittanceReview" c)
    UNION ALL
    (SELECT to_jsonb(c) FROM "ClaimRemittanceReview" c EXCEPT SELECT payload FROM original_reviews)
  ) THEN RAISE EXCEPTION 'Existing reviewed remittance changed'; END IF;
  IF EXISTS (
    (SELECT payload FROM original_cash EXCEPT SELECT to_jsonb(c) FROM "CashSourceEvidence" c)
    UNION ALL (SELECT to_jsonb(c) FROM "CashSourceEvidence" c EXCEPT SELECT payload FROM original_cash)
    UNION ALL (SELECT payload FROM original_cash_transactions EXCEPT SELECT to_jsonb(c) FROM "CashSourceTransaction" c)
    UNION ALL (SELECT to_jsonb(c) FROM "CashSourceTransaction" c EXCEPT SELECT payload FROM original_cash_transactions)
    UNION ALL (SELECT payload FROM original_cash_reviews EXCEPT SELECT to_jsonb(c) FROM "CashSourceReview" c)
    UNION ALL (SELECT to_jsonb(c) FROM "CashSourceReview" c EXCEPT SELECT payload FROM original_cash_reviews)
    UNION ALL (SELECT payload FROM original_org EXCEPT SELECT to_jsonb(c) FROM "Organization" c)
    UNION ALL (SELECT to_jsonb(c) FROM "Organization" c EXCEPT SELECT payload FROM original_org)
  ) THEN RAISE EXCEPTION 'Cash evidence or organization facts changed'; END IF;
  IF EXISTS (SELECT 1 FROM original_helpers h LEFT JOIN pg_proc p ON p.proname = h.proname
    AND p.pronamespace = current_schema()::regnamespace WHERE p.oid IS NULL OR pg_get_functiondef(p.oid) <> h.definition)
  THEN RAISE EXCEPTION 'Existing helper definition changed'; END IF;
END $$;
ROLLBACK;`;
    const path = join(directory, 'proof.sql');
    try {
      await writeFile(path, script, { mode: 0o600 });
      const result = await execFileAsync(
        process.execPath,
        [
          require.resolve('prisma/build/index.js'),
          'db',
          'execute',
          '--schema',
          resolve(import.meta.dirname, '../../prisma/schema.prisma'),
          '--file',
          path,
        ],
        {
          env: { PATH: process.env.PATH, DATABASE_URL: databaseUrl, NODE_ENV: 'test' },
          maxBuffer: 1024 * 1024,
        },
      );
      expect(result.stdout).toContain('Script executed successfully');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
