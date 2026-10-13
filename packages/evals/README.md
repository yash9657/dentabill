# Observation evaluation

`@dentabill/evals` compares frozen synthetic observations against separately authored reference
annotations. The `evaluate` commands run offline. A separate, explicitly authorized `capture`
command can collect synthetic Fireworks contract evidence as described below. Neither path has
production database access or a release promotion command. Runtime approval requirements remain unchanged.

## Run the workflow

From the repository root, choose a new output directory:

```bash
pnpm --filter @dentabill/evals evaluate seed --out /tmp/dentabill-eval-seed-001
pnpm --filter @dentabill/evals evaluate score \
  --corpus /tmp/dentabill-eval-seed-001/corpus.json \
  --results /tmp/dentabill-eval-seed-001/results.json \
  --out /tmp/dentabill-eval-replay-001
pnpm --filter @dentabill/evals evaluate verify \
  --corpus /tmp/dentabill-eval-seed-001/corpus.json \
  --results /tmp/dentabill-eval-seed-001/results.json \
  --report /tmp/dentabill-eval-seed-001/report.json \
  --review /tmp/dentabill-eval-seed-001/review.json
```

`seed` runs the existing fake gateway with **no registered response fixtures**. It therefore
abstains on every case. The annotations never become model responses. This deliberately weak
baseline demonstrates false abstentions and missed answerable cases; it is not a Fireworks run.

`score` evaluates saved results without invoking any model. `verify` recomputes both report and
review packet from their original inputs and the current implementation fingerprint. It checks
consistency, not authorship or provider authenticity. Changed inputs, omitted cases, changed
reports and a different scorer implementation require new artifacts. Output directories are
created exclusively with mode 0700 and files with mode 0600; existing directories are never
overwritten. Inputs are limited to 16 MiB each. Errors print closed codes, not source/output text.

## Annotation and result contract

The 25 checked-in examples are assistant-authored **DRAFT development hypotheses**. They cover
negation, corrections, attribution, partial payments, unallocated checks, reversals, coordination
of benefits, ambiguous currency, unknown code systems, injection and noisy transcripts. All
data is invented. They have not been reviewed by qualified dental billers and are not held out.

Each case pins its source, expected fields and exact reference citations. `rationale` and
`prohibitedInterpretations` document the intended meaning but are not executable scoring rules.
The scorer compares fields and citations only; it does not claim to detect every prohibited
interpretation or establish dental truth. `ADJUDICATED` requires two distinct reviewer records,
their independent original annotations and input digests, qualification-evidence references,
and an explicit final adjudication bound to the complete case. Future or inconsistent review
timestamps are rejected. These declarations do not authenticate reviewer qualifications.

Practice, patient, claim and scenario groups cannot cross development/calibration/held-out
partitions. Repeated claim IDs and exact source texts cannot cross either. Authors must identify
related templates, near duplicates and temporal families honestly; these checks cannot discover
all undocumented relationships. Do not move this seed into a held-out set after using it to
shape the implementation. A representative, independently reviewed corpus remains required.

Results contain the corpus digest, exact evaluation target and exactly one result per declared
case, bound to its request digest. The target changes only the request's release ID. No case
filter or missing-result shortcut is available. A gateway `FAILED` result belongs in the
inventory and remains a failure. Invalid model JSON also remains in scoring denominators.
Imported Fireworks identifiers and `capture` labels are **unauthenticated declarations** even
when their hashes and model names agree. There is no live capture command in this package.

## Read a report

- Schema and local semantic validity measure the gateway's structural/lexical rules. They are
  separate from reference field agreement, including exact claim/version, payment and code fields.
- Full agreement additionally requires the exact annotated citation multiset, including field,
  source/version, span and quote. Order does not matter; duplicates do. This conservative measure
  can reject a valid alternative excerpt and is not an entailment judge.
- Answerable correct coverage and false-abstention rate expose a model that refuses everything.
  Selective accuracy and required-abstention precision/recall retain their denominators. Empty
  cohorts return null rates. Failed executions never count as correct abstentions.
- Every declared tag and partition has its own counts and failure categories. Per-case records
  contain closed flags and counts; transcripts, quotes, amounts and reviewer IDs stay out of reports.
- Token subtotals use attempt receipts once, including failures/retries. Unknown usage remains
  explicitly unknown; a known subtotal of zero is not a claim of no spend. Cost remains null
  without pricing/billing evidence. Saved latency percentiles use nearest rank and are labeled
  unverified reported latency, not the speed of this offline replay.
- Field/citation differences are a correction-burden proxy. Human review time is unmeasured.
  No confidence interval is claimed for this correlated synthetic development set. Statistical
  intervals for future eligible samples need a defined sampling design; the
  [NIST interval reference](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm)
  describes Wilson and exact binomial methods.

`review.json` binds corpus, annotation, partition/inventory, result, report, target policy,
target artifact and evaluator source/dependency fingerprints. It always records
`productionApproval: false` and unresolved evidence gates. Hashes prove consistent bytes, not
authentic execution, adequate clinical accuracy, contractual suitability or permission to deploy.

## Next evidence required

Have two qualified dental billers independently label representative cases and adjudicate
disagreements, establish an untouched held-out cohort, ratify release thresholds, and collect
authorized provider captures with actual latency, usage, billing and correction-time evidence.
Provider license/revision, region/retention, spend authorization and protected-data approvals
remain separate release gates. Do not manufacture reviewer records or use perfect fixture
scores to approve a production model.

## Separate contract discovery (ADR-070)

`capture prepare` freezes a real, reviewable experiment without making network requests:

```bash
pnpm --filter @dentabill/evals capture prepare \
  --corpus /absolute/path/corpus.json \
  --candidate glm-flash-claim-observation.v1 \
  --evidence /absolute/path/capture-evidence.json \
  --allowance-usd 2 \
  --out /absolute/path/new-private-run
pnpm --filter @dentabill/evals capture inspect --run /absolute/path/new-private-run
```

The evidence file follows `CaptureEvidenceSchema` in `src/capture-plan.ts`. It records the
read-only account digest and evidence digest, current price/context sources, exact candidate
route, Standard rates in micro-USD per million tokens, publisher revision/license digest and
explicitly unverified serving revision/regional route. Use actual observations; no generated
evidence file, source URL or identifier proves contractual approval. Account/price/context evidence
must be at most 24 hours old at preparation. At most 25 complete synthetic cases are allowed.

The plan binds its exact corpus, candidate, source/dependency artifact, local host and canonical
run directory. It expires after 24 hours. It uses the production request builder and fixed US
transport with one attempt per case, output limit4096, response1MiB and deadline30s. The original
candidate stays CANDIDATE with no approval or guessed response identities. A separate discovery
transport can persist an unknown model response without returning an observation or bypassing
the production transport's identity check. `captured` means bounded raw JSON/usage was retained;
it does not validate the declared model, finish reason, content, dental accuracy or serving region.

After the human has authorized the concrete experiment and its spending allowance, use the
exact plan digest printed by `prepare`/`inspect`. A caller-provided digest is a trusted local
operator confirmation, not a cryptographically authenticated human signature:

```bash
pnpm --filter @dentabill/evals exec node --env-file=../../.env --import tsx \
  src/capture-cli.ts run --run /absolute/path/new-private-run --authorize-plan <exact-sha256>
```

Only `run` uses the process's `FIREWORKS_API_KEY`. It first performs a bounded read-only account
lookup and rejects a different/ambiguous account. It does not buy credits, change limits, create
agents, place phone calls or alter production settings. Do not run without the required budget
authorization; existing account quota is not a task budget. `prepare` and `inspect` need no key.

The monetary allowance reserves uncached input **and completion** at the entire documented model
context for every case, intentionally over-reserving hidden reasoning. Arithmetic rounds upward
in integer micro-USD. No refund or reuse of an uncertain request's allowance is allowed. This
is a conservative bound under the recorded price/context assumptions, not an enforced provider
invoice cap or measured cost. Regional router-to-model mapping and actual billing still require
evidence. Explicit wire usage above those token allowances stops remaining cases without sending;
unknown usage retains liability. Checking raw receipts on replay prevents an older cancellation
receipt with null usage from hiding a later-known overrun.

Run directories are 0700 and immutable records0600. Each admission and its reserved allowance
are published together through fsync and an atomic exclusive link before HTTP. Response bytes
are persisted before interpretation. A NO_SEND record claims the same slot, so concurrent
cancellation cannot hide a request. Completed runs reopen without another request; crashes
after a saved response replay locally. A dead owner's admission without a raw receipt becomes
UNKNOWN and never sends again. Live or foreign-host owners block takeover. Unattempted cases
remain in the report. Failed/unknown cases never establish zero cost or a valid model response.

This store is for one trusted operator on one local filesystem. Do not delete, clone, relocate,
or edit an authorized run to reset its budget. Local integrity bindings are not an adversary-proof
global account ledger or distributed service. Raw receipts can contain sensitive text; the CLI
prints only closed codes/counts/digests. Non-2xx error bodies are intentionally discarded while
status and uncertain usage remain. Do not commit private artifacts or treat discovery output as
an evaluator bundle. Reviewed response identity and a real synthetic-evaluation release are
still required for scored captures through the normal gateway.
