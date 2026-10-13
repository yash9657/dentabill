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
Untimestamped plain-hex signatures are rejected; simulation envelopes are not accepted over HTTP.

**FW06/FW07 local contract implemented.** Both documented envelopes now normalize
into source events. The eleven contract assertions pass without expected failures.
Lifecycle identity comes from event type plus call ID; cumulative snapshots use a
content hash and remain provisional until the terminal transcript arrives.

Run locally without vendor access:

```sh
pnpm --filter @dentabill/api exec vitest run test/integration/retell-webhook-contract.test.ts
```

This contract suite does not start Fastify or touch a database. Separate
`retell-webhook.test.ts` checks the HTTP/raw-body boundary, tenant binding, concurrent
redelivery, early delivery, actual Postgres rollback/retry, and out-of-order lifecycle
updates. `retell-webhook-process.test.ts` verifies receipt persistence before Call
registration, producer SIGKILL, worker completion from Postgres without callback events,
and replay after producer restart. These remain synthetic, not captured provider events.
The designated signing-key configuration and live telephony still require authorized
external validation. Worker crash/no-redial and durable summary dispatch remain W2 gaps.
