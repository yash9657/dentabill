# DentaBill model gateway

Server-only structured Fireworks inference for `claim-observation.v1`. This package is a
local implementation of FW-10–13 (ADR-063); workers and voice do not consume it yet.
Both checked-in models remain unapproved. Credentials alone do not enable inference.

`createFireworksGateway` implements `ModelGateway.generate(request, { signal })` and returns
`VALIDATED`, `ABSTAINED` or a closed-code `FAILED` result. Every successful observation requires
human review. The caller must authorize evidence, derive organization/data class, and persist
inference ownership and spend before calling. A matching source ID is not authorization.

The request selects an internal release ID and provides an invocation ID, scoped claim/version,
billed USD minor units and versioned final-transcript sources. It cannot supply a provider URL,
model, headers, tools, arbitrary parameters or fallback. Output is a payer-reported observation
with exact source spans; it is never a confirmed payment, settled claim or executed action.

## Release and transport controls

- Trusted server manifests bind exact US endpoint/regional route, observed response identity,
  organizations/task, prompt/schema/validator rules and implementation artifact hashes,
  evidence references, limits, dated review and run authorization. Runtime configuration cannot
  promote checked-in candidates. Evidence/artifact values must come from reviewed operational
  records; this library does not verify contracts or the deployment artifact itself.
- Request128KiB, response1MiB, JSON depth32, output4096 tokens, total30s and two attempts are
  upper bounds. Combined source text is limited to65,536 UTF-16 units. Releases may tighten
  these limits. Redirects and unknown serving models fail closed.
- Only explicit429/500/502/503/504 can retry once, including bounded backoff within the same
  deadline. Cancellation, network ambiguity and malformed/invalid output never trigger another
  generation. Abort is not proof of free or stopped inference.
- Each completed/active attempt survives timeout/cancellation. Missing usage stays null. Errors
  contain no raw provider body, exception, key or transcript. Successful observations contain
  sensitive evidence and must not be logged.

`VALIDATED` means schema and local source/lexical invariants passed. It does not establish
speaker identity, applicability, accuracy or payment truth. Amount/code parsing is deliberately
conservative; mixed adjudication, overpayments and unsupported evidence require review.
Representative adjudicated evaluations remain a release gate.

## Synthetic adapter

Use `createFakeModelGateway` explicitly with `SYNTHETIC_RELEASE_ID` and `dataClass:'SYNTHETIC'`.
Fixtures bind the complete input, including source text/version and invocation ID. Unregistered
inputs abstain. Outputs always carry `provenance.kind:'SYNTHETIC'`, no provider identity, and
unknown usage. Missing live credentials never select this adapter automatically.

## Verification

```sh
pnpm turbo run typecheck lint test build --filter=@dentabill/model-gateway
```

Tests use synthetic data and a localhost HTTP server. They cover release/input isolation,
exact wire fields, strict output/source rules, byte/depth/UTF-8 limits, retry/cancellation
accounting, late response rejection and native socket closure. They do not contact providers.

See [the contract register](../../docs/FIREWORKS_GATEWAY_CONTRACT.md),
[current evidence](../../docs/SESSION_CONTEXT.md) and [AWS integration gates](../../docs/DEPLOY_AWS.md).
FW-26 durable inference accounting and FW-27 versioned summary replacement must precede
automatic worker integration. Streaming/tools, voice, retrieval and document media are separate
tasks; rollback disables inference and returns work to review, without a provider fallback.
