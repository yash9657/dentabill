# DentaBill API on AWS

```
dentabill.site (Vercel) ──▶ api.dentabill.site ──▶ CloudFront ──▶ Lambda Function URL (RESPONSE_STREAM)
                                                                    │  Fastify API behind Lambda Web Adapter
                                                    SendMessage     ▼
                    worker Lambda ◀── SQS dentabill-jobs ◀──────────┘
                         │             └─ 3 receives ─▶ dentabill-jobs-dlq (alarm)
                         ▼
          Aurora Serverless v2 Postgres 17 (shared platform), via fck-nat for egress
```

What the code expects (modes, retries, env) is in `docs/DEPLOY_AWS.md`. Shared
network and database: `~/code/aws-platform`.

## Deploy

```bash
pnpm install && pnpm --filter @dentabill/api build:lambda
terraform init && terraform apply
```

Prerequisite: the `dentabill/clerk` secret (`aws-platform/scripts/owner-step.sh`).

## First-time database setup

Through the SSM tunnel (`aws-platform/scripts/db-tunnel.sh`):

1. `create role dentabill_app login password '<DB_ROLE_PASSWORD from dentabill/app>'`
   and `create database dentabill owner dentabill_app`.
2. Restore the Neon dump: `pg_restore --no-owner --role=dentabill_app -d <dentabill db> dentabill.dump`.
   Fresh installs run `prisma migrate deploy` instead.

## Notes

- `DOB_HASH_SECRET` is new on AWS. It only salts hashes written at CSV ingest,
  so existing rows are unaffected.
- `RETELL_WEBHOOK_SECRET` is new; demo mode has no real Retell account.
- Worker concurrency is capped at 5 (DB connections, concurrent calls).
- The Function URL is reachable directly, bypassing CloudFront; the API's own
  Clerk auth still applies.
