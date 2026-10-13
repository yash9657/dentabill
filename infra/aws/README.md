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

## Retell webhook credential

The default stack runs the no-key demo: `RETELL_WEBHOOK_SECRET` is omitted and
inbound Retell webhooks fail closed. To receive real webhooks, store the API key
marked with the webhook badge in Retell's dashboard as a **plain-text** Secrets
Manager secret, then set `retell_webhook_api_key_secret_id` to that existing
secret's name or ARN. Do not put the key itself in Terraform variables. The
legacy `RETELL_WEBHOOK_SECRET` environment name refers to that API key, not a
separate generated password. [Retell's signing documentation](https://docs.retellai.com/features/secure-webhook)
defines the credential; the app cannot establish dashboard badge status locally.

For stacks created before FW-28, the previously generated
`random_password.retell_webhook` value cannot verify real Retell webhooks. Review
the next Terraform plan: it should remove that random resource and the obsolete
field in `dentabill/app`, and omit the Lambda variable unless the existing-secret
reference above is supplied. Do not copy the old random value into the new
secret. A deployment and a signed webhook check are needed to complete the
migration; no account keys are rotated by this code change.

This input configures inbound verification only. Outbound telephony still needs
the separate API/worker configuration in `docs/DEPLOY_AWS.md`. Terraform resolves
the selected key into the API Lambda environment at deployment, so it also enters
encrypted Terraform state. After changing the webhook-designated dashboard key,
update the managed secret and redeploy before accepting events with that key.

## First-time database setup

Through the SSM tunnel (`aws-platform/scripts/db-tunnel.sh`):

1. `create role dentabill_app login password '<DB_ROLE_PASSWORD from dentabill/app>'`
   and `create database dentabill owner dentabill_app`.
2. Restore the Neon dump: `pg_restore --no-owner --role=dentabill_app -d <dentabill db> dentabill.dump`.
   Fresh installs run `prisma migrate deploy` instead.

## Notes

- `DOB_HASH_SECRET` is new on AWS. It only salts hashes written at CSV ingest,
  so existing rows are unaffected.
- `RETELL_WEBHOOK_SECRET` is optional in the no-key demo; see setup above.
- Worker concurrency is capped at 5 (DB connections, concurrent calls).
- The Function URL is reachable directly, bypassing CloudFront; the API's own
  Clerk auth still applies.
