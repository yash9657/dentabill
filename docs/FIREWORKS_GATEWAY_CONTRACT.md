# Fireworks stateless gateway contract evidence — FW-10 through FW-13

**Checked:** 2026-10-13, America/Los_Angeles. **Status:** primary-source research plus local FW-10–13 implementation in `packages/model-gateway` (ADR-063). The acceptance cases below now have synthetic/local HTTP tests; exact final evidence is in SESSION_CONTEXT.md. No inference, speech, provider configuration change, purchase, deployment or production model approval occurred. Credential presence and any separate read-only authentication results are recorded in PROVIDER_EVIDENCE.md.

This supplements [provider evidence](./PROVIDER_EVIDENCE.md) and the [implementation plan](./FIREWORKS_IMPLEMENTATION_PLAN.md). The first slice is a text-only, nonstreaming, stateless adapter and fake behind one typed interface. Streaming voice/tool execution, embeddings, reranking, document media, inference-job persistence and provider cutover remain separate work. The user's ElevenLabs exception covers speech/orchestration; business inference remains restricted to approved Fireworks-hosted open weights.

## FW-42 isolated contract discovery — 2026-10-13

ADR-070 adds an explicit discovery-only experiment path to resolve the initial unknown response
identity without inventing release evidence. `createFireworksDiscoveryTransport` shares the
fixed endpoint, bounded request lifecycle and awaited journal with normal transport, but returns
no completion content or observation. The local `@dentabill/evals capture` CLI binds synthetic
cases, candidate, current account/price/context/license evidence, exact artifact, host/path,
allowance and expiry. Every case has at most one send; unknown acceptance stays reserved, saved
raw responses replay without a network request, and concurrent cancellation cannot mask a send.

Candidates remain unapproved, their serving revisions unknown, and normal gateway identity/
release gates unchanged. This explicitly authorized discovery is the prerequisite for measured
identity evidence; a subsequent scored synthetic-evaluation release still needs reviewed scope
and applicable provider evidence. Local capture files are not deployment artifacts, authenticated
domain adjudication, production approval or an account-wide dollar enforcement service. See
`packages/evals/README.md` and the dated actual read-only checks in PROVIDER_EVIDENCE.md.

## FW-27 local observation publication/review — 2026-10-13

The explicit worker can now publish validated saved native results into immutable observation
history. Every new request has one source from the latest durable final CallEvent with exact
raw text; source ID identifies the event and source version is SHA-256 of that text. Replay and
publication verify the bound event belongs to the run's call. Publication rechecks this inside
its database transaction, freezes output/source/provenance and commits its audit plus APPLIED
marker independently of provider usage. It does not rewrite legacy summaries or financial state.

Biller review binds the immutable digest and exact claim version, rejects changed claims/newer
calls/superseded findings, and is idempotent for the same actor/decision/note. Original intent
creation time orders recovered calls; later database insertion cannot promote old evidence.
The UI preserves review history alongside later stale warnings and labels synthetic data even
when a local native HTTP fixture uses FIREWORKS provenance. This establishes local workflow
invariants only. Same-call regeneration and automatic native routing are now implemented locally
(ADR-067/068); live evaluation/deployment and notification delivery remain open. Corrected, changed
or missing final transcripts make existing reviews stale. ADR-066.

## FW-41 local durable integration — 2026-10-13

The native gateway now requires an awaited journal. `createDurableObservationGateway` in
summary-worker binds the request, source/claim version, release policy, exact wire hash,
attempt cap and original send deadline to the Postgres inference ledger. It remains an explicit
adapter; existing summary jobs and the voice path do not select it. No candidate model became
approved and no external inference ran (ADR-065).

Each native HTTP request waits for its own committed admission. The first retryable response
and completed attempt must commit before retry allocation; each retry reserves the full
allowance separately. A bounded complete success body is persisted before JSON/model/finish/
usage or semantic validation. For non-success HTTP responses only status and bounded retry
delay are retained; arbitrary error bodies are discarded. Known usage survives validation
failure. Missing or contradictory totals remain unknown, and any unknown attempt makes the
invocation total unknown even when a later attempt succeeds. The local ledger holds unknown
liability across UTC days; token allocations do not certify actual dollar cost.

The implementation rechecks cancellation/deadline after awaited admission and immediately
before native fetch. Saved responses can be revalidated after restart using a fresh local
validation budget, but the original deadline still prohibits a new HTTP send. Ambiguous sends
without a saved response are never automatically resubmitted. Cancellation interpretation
can be refined once from an already-saved response while retaining its prior history.
Expired reservations with no attempt are refunded when revisited under the organization lock; expired or
cancelled attempts with uncertain provider acceptance retain their allocation.

Primary docs were refreshed for this boundary. Chat Completions does not document an
idempotency/retrieval contract that makes a lost response safe to resend. The separate stored
Responses API is not a Chat Completions recovery mechanism. Retry guidance recommends explicit
HTTP statuses but does not prove the first request was unbilled. Billing exports and quotas
also do not establish a synchronous atomic budget gate. Therefore no absent usage, elapsed
timeout or retryable status is treated as proof of zero cost.
[Chat reference](https://docs.fireworks.ai/api-reference/post-chatcompletions),
[reliability](https://docs.fireworks.ai/guides/reliability),
[stored response retrieval](https://docs.fireworks.ai/api-reference/get-response),
[usage exports](https://docs.fireworks.ai/accounts/exporting-usage-and-costs),
[account quotas](https://docs.fireworks.ai/guides/quotas_usage/account-quotas).

Local evidence includes native localhost HTTP + Postgres, separate-process SIGKILL at request
reservation, raw-response commit and second-attempt admission, a provider's independently
fsynced acceptance ledger, and cancellation while admission is blocked in a real transaction.
These prove local failure behavior; selected-route protocol, dental quality, account policy,
streaming voice and real-provider recovery remain unverified. Versioned observation application
is FW-27 and notification delivery is FW-40.

## Current primary contracts and limits

### Endpoint and model identity

The documented US endpoint is `https://us.api.fireworks.ai/inference/v1/chat/completions`. It requires a US model route, not merely a generic model ID on the US hostname. Current US route listings still include both plan candidates below, plus GLM 5.3 and Kimi K3. A published route is neither account access nor an immutable serving-artifact guarantee. [US-only Serverless](https://docs.fireworks.ai/serverless/us-only-serverless)

| Candidate, still unapproved | Current documented US request model                 | Publisher evidence refreshed                                                                                                                                                                                     | Missing evidence                                                                                                                        |
| --------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| GLM 5.3 Flash               | `accounts/fireworks/routers/glm-5p3-flash-us`       | Publisher card identifies MIT; a LICENSE file is published. [Card](https://huggingface.co/zai-org/GLM-5.3-Flash), [license](https://huggingface.co/zai-org/GLM-5.3-Flash/raw/main/LICENSE)                       | Exact served weights/revision/quantization and their correspondence to this licensed artifact; account capability and dental evaluation |
| DeepSeek V4.1 Flash         | `accounts/fireworks/routers/deepseek-v4p1-flash-us` | Publisher explicitly covers repository and weights under MIT. [Card](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash), [license](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash/raw/main/LICENSE) | Same gates; no inference that agreement with another model verifies a fact                                                              |

These license links follow mutable `main`; archive an exact publisher revision/license hash before release. This is license evidence, not legal approval of the complete product/data use. The refreshed recommended-model page emphasizes several different families for extraction and vision and does not establish the plan's GLM Flash preference. Keep both as evaluation candidates; do not select by catalog rank. GLM 5.3/Kimi K3 and retrieval candidates require their own release records rather than inheriting the two licenses above. [Current recommendations](https://docs.fireworks.ai/guides/recommended-models)

**Routing distinction:** named US `/routers/...-us` resources are documented regional routes. They are not permission to accept arbitrary router paths. FireRouter can send a turn to closed models using connected provider credentials; `auto` and family aliases can change their serving model. Ban dynamic routing, `firerouter`, `auto`, `*-latest`, unknown IDs and cross-provider fallback in this slice. Only exact manifest entries may be used. [FireRouter contract](https://docs.fireworks.ai/nexus/firerouter)

Enterprise residency is account-wide enforcement, defaults to unrestricted, and rejects nonmatching endpoint/model requests; it does not move traffic. `inference_geo` and `Fireworks-Inference-Geo` are deprecated. FireRouter is incompatible with enforced residency. Check account policy and actual regional route behavior before protected use; do not confuse a US inference endpoint with the location/retention of every support, metadata or subprocessor flow. [Data residency](https://docs.fireworks.ai/accounts/data-residency)

### Structured output and strictness

The documented request format is `response_format: {type: 'json_schema', json_schema: {name, schema}}`. Prompt instructions should also describe the JSON contract; constrained decoding does not supply the schema's meaning to the model. `json_object` only promises JSON syntax. Length termination may produce incomplete JSON. Current schema documentation supports in-document references and several composition/size constraints, but not external references. Regex enforcement is best effort: unsupported lookaround can be ignored while the request succeeds. It also documents JSON-schema mode disabling reasoning output. Treat these as vendor claims requiring selected-route probes. [Structured Outputs](https://docs.fireworks.ai/structured-responses/structured-response-formatting)

The current API schema has a `strict` property on tool functions, while `response_format.json_schema` is an open object. The sources reviewed do **not** establish an OpenAI-equivalent guarantee for `json_schema.strict: true`, nor universal rejection of unsupported keywords. Do not invent that guarantee or silently downgrade to unconstrained text when a schema is rejected. Keep runtime validation authoritative. [Chat Completion reference](https://docs.fireworks.ai/api-reference/post-chatcompletions)

Implemented local schema subset: closed objects, explicit required fields, bounded arrays/strings, scalar types/enums and explicit nullable values; no remote refs or recursive schemas. The explicit UTC/calendar pattern is a decoding hint; local Zod date validation remains authoritative. Provider string-length rules may count code points while local text/quote limits use UTF-16 units. More capable provider grammar support does not require exposing it through our first contract. Schema versions must pin both emitted JSON Schema and the local validator. Financial amounts use integer minor units with a currency; identifiers remain strings. A syntactically valid object is never proof of identity, policy coverage, payment or permission to act.

### Statelessness, retention and cache isolation

Fireworks documents no persistent prompt/generation storage for open models without opt-in. Volatile prompt/KV caching and service metadata remain. Responses API differs: `store` defaults true and stored conversations are retained for thirty days; `store:false` opts out for that API. The Chat Completion schema reviewed has no documented `store` field. Therefore do not add `store:false` to chat and claim it establishes retention. Use chat only, omit metadata/tracing/distillation and other content-persisting options, and reject caller extras. [Baseline data handling](https://docs.fireworks.ai/guides/security_compliance/data_handling)

Enterprise account ZDR enforcement is distinct from the baseline policy. It allows chat/completions but rejects stored/background responses, FireRouter, batch, training and evaluator jobs. It does not delete prior data, disable volatile caches or remove all legally required/abuse-related retention. Record the account's actual effective setting and contractual scope; this work neither changed nor verified it. [Account ZDR policy](https://docs.fireworks.ai/accounts/zero-data-retention)

Prompt caching is enabled by default. Serverless caches are separated by Fireworks account, not necessarily by DentaBill tenant; dedicated deployments share a cache by default. The documented `prompt_cache_isolation_key` or corresponding header adds separation. Proposal: derive an opaque per-tenant/per-release isolation key server-side; never use names, member IDs or claim text. Do not describe an isolation key as disabling caching. [Prompt-cache privacy](https://docs.fireworks.ai/guides/prompt-caching#data-privacy)

The security page advertises HIPAA support and describes access/encryption controls; it is not DentaBill's executed BAA or a verified account entitlement. Protected inputs remain blocked pending applicable agreements, subprocessors, regional processing, support/log access and retention/deletion review. Synthetic local work can proceed independently. [Vendor security statement](https://docs.fireworks.ai/guides/security_compliance/data_security)

### Completion, usage and failures

Nonstreaming responses include choices, model and usage; completion-token counts may be null in the reference schema. `max_completion_tokens` aliases `max_tokens` and cannot be sent with it. Proposal: send one bounded `max_tokens`, require one complete assistant text choice, and preserve unavailable usage as unknown. Never convert missing usage to zero or expose reasoning content. [Chat Completion reference](https://docs.fireworks.ai/api-reference/post-chatcompletions)

Fireworks defaults to reducing the output allowance when prompt plus output exceeds context. Set `context_length_exceeded_behavior:'error'` so an unexpectedly reduced budget is not silently accepted. [Compatibility differences](https://docs.fireworks.ai/tools-sdks/openai-compatibility#differences)

Rate limits are account/model scoped and adapt over time. Published ceilings are not this account's limit or a success guarantee; overload can return 503 even below quota. Read only allowlisted numeric rate-limit headers if needed. [Rate-limit contract](https://docs.fireworks.ai/serverless/rate-limits)

The reliability guide recommends backoff for 429/500/502/503/504 and gives workload-dependent client timeouts. The error-code page additionally lists 402/403/408/412/413/520 and describes 500 less optimistically. These are not an idempotency or exactly-once billing contract. A lost response/cancelled connection does not prove generation stopped or was free. [Reliability](https://docs.fireworks.ai/guides/reliability), [error codes](https://docs.fireworks.ai/guides/inference-error-codes)

Implemented FW-13 policy: thirty seconds end-to-end including headers, body read, parsing, backoff and both attempts; at most two attempts total, with retries allowed only for explicit 429/500/502/503/504 responses. Disable SDK/framework retries, use bounded jitter and honor a valid Retry-After only if it fits the remaining budget. No retry on cancellation, ambiguous network failure/timeout, malformed output, schema/semantic failure, refusal, configuration/auth/payment failure or other status. Discard/cancel error bodies without logging them. Record each attempt's known usage; retain an unknown-cost marker where acceptance is ambiguous. Any later retry policy change requires a measured budget rationale.

Price references must be versioned by region and service tier. Current Standard US rates per million input/cached-input/output tokens are GLM Flash $0.225/$0.045/$0.75 and DeepSeek Flash $0.45/$0.009/$1.80. These match the prior evidence table; they are not measured case costs or purchase authorization. Keep Priority disabled unless separately approved. [Current pricing](https://docs.fireworks.ai/serverless/pricing)

### Streaming and tools: deferred contract, not a voice-compatibility claim

Tool arguments arrive incrementally and are correlated by tool index; parallel-tool support varies by model. A tool proposal is not an executed action. The future parser must assemble and validate complete arguments, enforce allowed tools and permissions, and handle interruption/replay before execution. [Tool Calling](https://docs.fireworks.ai/guides/function-calling)

There is a documentation discrepancy to preserve in fixtures: the current API reference describes a final usage SSE chunk with empty `choices` before `[DONE]`, separate from `finish_reason`; the text guide describes usage on the finish chunk. A future reader must tolerate both shapes and never index `choices[0]` unconditionally or stop before collecting final usage. Missing terminal markers/usage after interruption remain explicit unknowns. This must be measured on the chosen route and ElevenLabs gateway before voice approval. [API stream options](https://docs.fireworks.ai/api-reference/post-chatcompletions), [text guide](https://docs.fireworks.ai/guides/querying-text-models#usage--performance-tracking)

## Implemented local gateway boundary

These are DentaBill boundary controls, not proof of model behavior or a deployed workflow.

1. **FW-10:** one typed text-generation port plus deterministic fake. Input names an internal immutable `releaseId`, task/schema/prompt version, bounded source references, task input and abort signal. It does not accept a raw provider URL, model ID, arbitrary HTTP headers, tools or request extras. Trusted callers derive tenant/source authorization; the provider cannot authorize it. Keep PHI-bearing input/output distinct from safe diagnostic metadata.
2. **FW-11:** a native-fetch adapter owns the exact HTTPS endpoint and authorization header. Server configuration resolves the internal release to an exact documented route. Reject credentials in URLs, custom ports, query strings, redirects and unknown hosts/paths; never follow a redirect with the key. Inject transport for fixtures, not an unrestricted production base URL. No default production release; key presence alone does not activate inference.
3. **FW-12:** bound request/response bytes and JSON depth; reject extra choices, missing/null content, tool output and non-`stop`/unknown finish reasons. Parse exact JSON without code-fence stripping, repair prompts or second-model fallback. A task validator checks echoed identity, source IDs/versions, amount/currency invariants and permitted abstention. A provider refusal field or nonconforming refusal text is a typed non-success; do not invent a Fireworks refusal-field guarantee. Business policy receives only validated structured output, never raw reasoning.
4. **FW-13:** use one monotonic deadline plus propagated cancellation, bound body reads, recheck cancellation/deadline immediately before sends and before accepting results, and reject late completion even from a transport that ignores abort. Retry only under the policy above. Error surfaces contain stable codes/status, attempt count and safe timing/usage; never provider body/message, input, output, key, stack/cause or arbitrary headers. Do not log a raw fetch/SDK exception.

Implemented safety bounds are 128 KiB serialized request, 1 MiB response, 4,096 maximum output tokens, thirty-second total deadline and two attempts. These are conservative testable product limits, not vendor capabilities. A release can tighten them; widening them requires a reviewed workload/budget change. The wire body is constructed from an allowlist: exact model, system/user text messages, `stream:false`, `n:1`, bounded `max_tokens`, `context_length_exceeded_behavior:'error'`, versioned JSON response format and the server-derived cache isolation key. Sampling settings, if used, belong to the release manifest and evaluations rather than caller overrides.

The result distinguishes validated output from abstention and typed failure, and carry internal release/prompt/schema versions, bounded provider response ID/model, accepted stop-only completion, attempt counts, elapsed time and usage completeness. A provider response's `model` may differ from the requested regional route: release approval must record measured allowed response identities, not guess an equality rule or accept any string. Unknown/mismatched identity fails closed. Provider IDs/model strings are untrusted and must not be forwarded into logs before validation.

## What can be proved without a key

| Fixture or regression                                | Required assertion                                                                                                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native HTTP contract via injected transport/loopback | Exact fixed host/path/header/body; regional route allowlist; no redirect, model fallback, vendor traffic, tools, storage options or caller extras                                       |
| Fake release and source binding                      | Wrong tenant/source version/release/schema rejected before transport; fake output cannot carry an approved/live provenance label                                                        |
| Schema and semantic boundary                         | Valid JSON with wrong identity/currency, invented source reference, impossible amount, unexpected properties or provider refusal is not usable evidence; missing evidence abstains      |
| Truncation/protocol errors                           | Length finish, null/unknown finish, malformed JSON, HTML200, extra choices, oversized/deep/slow body and unknown serving model fail with sanitized codes                                |
| Timeout and cancellation                             | Abort before send, during headers/body/backoff, hung/abort-ignoring transport and late successful response produce no accepted late output or additional attempt                        |
| Bounded retry                                        | Explicit transient status retries at most once within the same deadline; Retry-After cannot extend it; auth/payment/parse/semantic errors and ambiguous network outcomes never retry    |
| Usage and privacy                                    | Missing/nullable token fields stay unknown; known counts validated; private strings in payload/error/header/stack never appear in captured logs or public errors; raw reasoning ignored |
| Future SSE/tools, separately gated                   | Split UTF-8/JSON arguments, multiple indices, empty-choice usage, both documented usage placements, disconnect/duplicate/interruption never execute partial or stale tools              |

These tests establish our boundary behavior only. They do not prove a model follows the schema, bills as expected, runs in the claimed region, honors retention, meets latency targets or performs accurate dental extraction.

## Release policy and remaining gates

Maintain a checked-in reviewed release manifest with explicit **candidate**, **synthetic-evaluation enabled**, **approved for a named workload**, and **disabled** states. None of the candidates in this document is approved. A fake or HTTP fixture never changes that state. Runtime selection cannot promote a candidate, and environment keys cannot bypass it.

Each enabled entry binds exact route/endpoint, publisher artifact and license revision, observed serving identity/revision, prompt/schema/validator-rule hashes, implementation artifact SHA-256, output/deadline/retry limits, region/retention policy evidence, price snapshot, evaluation artifact and reviewer/date/scope. The approved policy digest detects changed scope or limits; expiry is checked on every invocation. The references and supplied application artifact identity remain trusted server records and need a future build/release verifier; rule-descriptor hashes alone do not attest compiled validator code. A router name or publisher model card alone cannot pin the served weights. If Fireworks cannot attest the required serving identity, retain that blocker rather than inventing a revision.

Before any authenticated synthetic probe, establish permitted account/key access, existing spend limits, explicit evaluation release scope and a bounded run manifest. Before real data, additionally establish applicable BAA/DPA/retention/support/subprocessor terms and authorized source access. Verify account residency/ZDR/model restrictions read-only first; changes, paid capacity and deployments are separate authorized operations. No access or contract is established here.

Before workload approval, capture regional JSON/schema/finish/usage/error behavior using authorized synthetic runs, then qualified dental adjudication across noisy/partial/contradictory evidence, wrong-plan cases, identifiers, amounts and abstention. There is currently no clinic or adjudicated case set. Evaluate cost/latency including failed attempts and unknown usage. Preserve default-disabled live inference and the existing synthetic demo while these gates are open.

Rollback disables new inference or returns work for human review; it does not switch to GPT/Claude, mutable automatic routing, an unapproved Fireworks model, or an unrelated voice provider. This gateway cannot settle claims, confirm payment, execute tools or repair call intent ambiguity. Inference-job deduplication/cost reservation and production integration must be addressed before connecting the adapter to retrying workers.

## Local task limits

The first task consumes only final call transcripts and emits one reviewable claim-level
observation. Input authorization belongs to the trusted caller; matching organization/source
IDs cannot establish authorization. Sources are cloned, uniquely identified, tied to the claim
version and capped at 65,536 combined UTF-16 units before the serialized request bound.

Evidence binds exact UTF-16 source spans. Payment values use USD integer minor units with a
bounded, explicit dollar-amount mention; foreign-currency qualifiers, ambiguous notation and
amounts above billed value fail review checks. The amount's bounded source context is inspected
so cropping an evidence quote cannot hide a currency qualifier, sign or multiplier. These are
conservative lexical rules with known recall limits, not exhaustive language interpretation.
Codes retain raw spelling and UNKNOWN system unless cited text explicitly names the nomenclature.
No code dictionary, benefit interpretation, clinical fact, payment match or settlement is inferred.

Mixed paid/denied lines, overpayments, unsupported evidence and contradictions need abstention/
human review; full procedure-level adjudication remains in the domain backlog. VALIDATED means
schema and implemented invariants passed, never that a model's assertions are true. Returned
observations contain sensitive evidence; only closed failure/status/timing/usage fields are safe
for diagnostics. Application telemetry remains FW-14. FW-26 now provides the synthetic
workflow ledger; FW-41 must connect awaited per-HTTP-attempt admission/receipt hooks before
this transport can use it. Current progress callbacks are best effort and do not durably
authorize a send. Versioned observation/summary application remains FW-27 (ADR-064).

Cancellation-safe progress preserves completed attempts and the current possible acceptance
without inventing a send during backoff. Missing usage stays null. Opaque response-ID character
limits and defensive refusal/content-filter rejection are local acceptance policies; Fireworks
has not been measured to guarantee those exact fields/identities. Test fixtures always use
synthetic releases and cannot approve either checked-in candidate.
