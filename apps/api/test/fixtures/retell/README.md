# Retell documented-envelope regressions (FW06)

**Provenance:** hand-authored synthetic fixtures from primary documentation retrieved
2026-10-13, checked against installed `retell-sdk@5.16.0` call types and signing
helper. These are not captured provider deliveries, patient data, or placed calls.
The reserved fictional phone numbers are never dialed. Optional metadata and dynamic
variables are omitted deliberately; no internal `eventId` or `deliveredAt` is added.

Sources:

- [Retell webhook overview](https://docs.retellai.com/features/webhook-overview):
  body contains string `event` and a `call` object; started carries basic call
  information, ended omits analysis. Retries may overlap later events.
- [Retell get-call contract](https://docs.retellai.com/api-references/get-call):
  snake-case call fields, Unix-millisecond timestamps, duration and disconnect reason.
- [Retell signature verification](https://docs.retellai.com/features/secure-webhook):
  `v=<unix_ms>,d=<hex>` authenticates raw body concatenated with timestamp, with a
  five-minute window, using the account's webhook-badged API key.
- Installed `retell-sdk/lib/webhook_auth.js` implements that signature locally;
  `retell-sdk/resources/call.d.ts` defines `PhoneCallResponse`. No SDK upgrade occurred.

`retell-webhook-contract.test.ts` signs the committed raw bytes with a synthetic key
and fixed clock. It rejects same-length byte tampering, reserialized JSON, an unrelated
key and an expired timestamp. No network client is created, and no signature is logged.
Plain-hex acceptance is labeled legacy fixture behavior, not the provider contract.

**FW06 reproduced; FW07 unimplemented.** The exact parser used by the webhook route
rejects both documented envelopes: it expects internal `eventId`, `deliveredAt`, and
an object-valued `event`. Two `it.fails` cases specify the desired normalization and
are deliberately labeled **BLOCKED**; ordinary diagnosis assertions also identify the
current mismatch. A green Vitest run therefore means the known incompatibility was
reproduced, not that provider ingestion works. When FW07 lands, replace the mismatch
assertions and remove `it.fails`; do not merely delete or skip these cases.

Run locally without vendor access:

```sh
pnpm --filter @dentabill/api exec vitest run test/integration/retell-webhook-contract.test.ts
```

This suite does not start Fastify or touch a database. HTTP ingestion, raw-body plugin,
durable inbox/replay, event mapping, transcript delivery, cross-process call completion
and real signed provider delivery remain unverified by it. The route's
`RETELL_WEBHOOK_SECRET` must separately be reconciled with the provider-designated
signing key: an arbitrary Terraform-generated value does not establish that contract.
