# DentaBill synthetic walkthrough and recording guide

This guide rehearses the implemented dashboard with a small, connected set of invented records. The core walkthrough takes about **7–8 minutes after sign-in**. Optional call, correction and recovery chapters are separate. It is a recording script, not evidence that a real Clerk session, live PMS/bank connection or recording has been completed.

The presenter records the walkthrough after local setup and rehearsal. No video asset is supplied by this guide, and no landing-page recording is installed yet.

## Prepare the local workspace

Use a dedicated local database named `dentabill_demo_<run>` and an authenticated synthetic practice with a real Clerk development organization. Keep production data and credentials out of the recording.

- Use the repository’s pinned pnpm version (`pnpm@10.33.0`) and supported Node version (`>=20.19`). Install with `pnpm install --frozen-lockfile` when needed.
- The local database must have the current migrations, and the pinned workspace dependencies must be installed. Preflight generates its own temporary Prisma client from the checked-in schema. Preparing an empty demo database is a separate setup action; this guide does not reset or replace an existing database.
- Configure a real Clerk development session for the browser and corresponding API keys. The API startup output must say `auth mode: clerk`. Browser requests obtain a Clerk bearer token; `x-test-user-id` and `x-test-org-id` are integration-test facilities, **not browser sign-in**.
- Confirm that the actual Clerk `user_…` and active `org_…` map to the intended local DentaBill user and organization. The preflight requires **OWNER or ADMIN**, one practice and one actor in this isolated database, and an exact real Clerk organization binding; `local_*` bindings are not accepted for this recording setup. Use the top-bar organization switcher to select that practice after sign-in. Sign-in alone does not create or verify the local binding.
- Configure the local web/API origins consistently, including the web `NEXT_PUBLIC_API_URL`. The usual development URLs are `http://localhost:3000` and `http://localhost:3001`; use the configured ports if different.
- Keep telephony, paid model, billing and external email delivery disabled. The optional call chapter needs the separately verified synthetic runtime described below; the core financial-review chapter does not need a call.

### Read-only preflight

Supply the configuration explicitly in the command environment. Preflight stages a private Prisma client with no configured dotenv paths and bundles its application code into a temporary runtime; generation, bundling and execution each receive an explicit environment. The temporary runtime is removed afterward. Keep actual secrets in your approved local secret mechanism and out of terminal recordings or this document. Use the trusted installed Node/pnpm toolchain and remove preload, module-path, bundler-binary and debug overrides before invocation; checks inside the command cannot undo code already executed by its launcher.

| Configuration                                                           | Required value or constraint                                                                                                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                                          | Local PostgreSQL (`localhost`, `127.0.0.1` or `::1`), database `dentabill_demo_<run>`, current migrations; only the intended practice and actor.       |
| `NODE_ENV`                                                              | `development`                                                                                                                                          |
| `NEXT_PUBLIC_APP_URL`                                                   | Local HTTP web origin, typically `http://localhost:3000`.                                                                                              |
| `NEXT_PUBLIC_API_URL`                                                   | A different local HTTP API origin, typically `http://localhost:3001`.                                                                                  |
| `INTERNAL_API_BASE_URL`                                                 | Exactly the API origin.                                                                                                                                |
| `API_CORS_ORIGINS`                                                      | Omit it or set only the web origin.                                                                                                                    |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`                 | Actual matching Clerk development-instance test keys (`pk_test_…` / `sk_test_…`). Optional `CLERK_PUBLISHABLE_KEY` must equal the web publishable key. |
| `INTERNAL_JOB_SECRET`, `DOB_HASH_SECRET`                                | Nonempty locally supplied secrets of at least 32 / 16 characters respectively.                                                                         |
| `JOB_DISPATCH_MODE`                                                     | `inline`                                                                                                                                               |
| `SUMMARY_ANALYSIS_PROVIDER`                                             | `SYNTHETIC`                                                                                                                                            |
| `SUMMARIZER_AUTO_TRANSITION_ENABLED`                                    | `false`                                                                                                                                                |
| `DEMO_AUTOPILOT`, `DEMO_IGNORE_PAYER_HOURS`, `DEMO_SUMMARIZER_FALLBACK` | Each exactly `true`.                                                                                                                                   |

Remove inherited live-service configuration from this dedicated process environment. Preflight refuses nonempty Retell, Fireworks, Anthropic, OpenAI, Stripe, mail, AWS, Vercel/Railway, Telnyx/Twilio, ElevenLabs, Upstash and Sentry settings; it also refuses Redis/SQS URLs, model-release selectors, the Clerk webhook secret, `NODE_OPTIONS`, `NODE_PATH`, `ESBUILD_BINARY_PATH`, `DOTENV_CONFIG_PATH` and `DEBUG`. Clerk test authentication is the intentional external service. A presence/format check of its keys is not proof that authentication succeeds.

From the repository root, with those explicit variables already supplied, run:

```bash
pnpm --filter @dentabill/api exec tsx scripts/demo-preflight.mts \
  --organization-id '<local-organization-id>' \
  --user-id '<local-user-id>' \
  --clerk-organization-id 'org_REPLACE_WITH_ACTUAL_ID' \
  --clerk-user-id 'user_REPLACE_WITH_ACTUAL_ID'
```

Replace every placeholder with the intended actor’s actual identifiers. Success prints `PREFLIGHT_PASSED`, `readOnly: true` and the migration count/actor role, while authentication, authenticated rehearsal and recording remain explicitly **not verified**. It checks local configuration, the bundle, migrations and database bindings in a read-only transaction. It does not start servers, create an actor or practice, apply migrations, upload records, contact Clerk to validate membership, or record a video. A failure returns a closed reason code; fix the named prerequisite rather than weakening the guard.

**Launch remains a separate pending step.** Guarded local actor provisioning, isolated database preparation and the environment-clean API/web launcher must be completed and rehearsed before using this guide to record. Do not treat raw `pnpm dev`, inherited `.env` files or dotenv symlinks as the verified launch path. Do not substitute the legacy seed or simulator for a missing prerequisite.

Do **not** run `seed:demo --reset`, the old 40-claim demo seed, or `demo:call` / `simulate-live-call.mts` for this walkthrough. Their old assumptions and unscoped simulation are not this bundle’s authenticated workflow. Do not create test-header browser bypasses.

## Use the connected demo bundle

Files live in [`apps/web/public/examples/demo/`](apps/web/public/examples/demo/). The machine-readable [`manifest.json`](apps/web/public/examples/demo/manifest.json) is the source of truth for names and relationships. While the web app runs, the same files are available under `/examples/demo/`.

| File                    | Where to use it                            | Expected source facts                                                                                                                         |
| ----------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `claims.csv`            | Claims → Upload claims                     | Open Dental source; **Source database `synthetic-demo-office`**; claims `DEMO-CLAIM-A` / `DEMO-CLAIM-B`, billed $200 / $160.                  |
| `remittance-a.json`     | `DEMO-CLAIM-A` detail → remittance section | Payment report $100; record `demo-remittance-a`; exact imported line.                                                                         |
| `remittance-b.json`     | `DEMO-CLAIM-B` detail → remittance section | Payment report $80; record `demo-remittance-b`; exact imported line.                                                                          |
| `batch.json`            | Remittance batches                         | Original batch `demo-batch`; reports $180, provider adjustment −$30, net $150.                                                                |
| `cash.json`             | Cash evidence                              | Account source transaction `demo-bank-transaction`, signed amount +$150.                                                                      |
| `posting.json`          | Posting evidence                           | Receipt `demo-posting-receipt`; header +$150; listed PAYMENT +$100 and TRANSFER +$80; complete entry amount +$180 and header difference −$30. |
| `batch-correction.json` | Optional correction chapter only           | Same original batch, new observation, v2 sequence 1; adjustment −$40 and net $140.                                                            |

The imported claim source IDs are `demo-claim-a` and `demo-claim-b`, with source lines `demo-line-a` / `demo-line-b` and procedures `demo-procedure-a` / `demo-procedure-b`. The remittance namespace is `synthetic-demo-payer`; it is deliberately different from the claim source database. Do not replace either namespace or manufacture new source IDs to get past a blocker.

The posting payment entry names claim A’s exact source line and procedure. The transfer entry names claim B but supplies **no source line ID**; its raw procedure `demo-unresolved-procedure-b` remains unresolved. It can be associated with the claim only.

These are custom manual JSON import contracts, not native 835, bank, or PMS connector exports. Keep the existing single-file examples separate: their fake source references are not a substitute for this connected bundle.

## Core walkthrough: about 7–8 minutes

Complete any optional call/claim-edit chapter **after importing claims but before accepting financial evidence or recording posting associations**. A call or claim edit changes the claim version and can make earlier reviewed evidence stale.

### 0:00–0:30 — Set expectations in Overview

Open `/dashboard/overview` after signing in to the intended practice. Identify the practice and the actual activity shown; an empty practice is a valid starting state. Do not populate or narrate old “recovered this week” seed targets.

**Say:** “This is a synthetic local demonstration. We’ll import claims, review what each source reports, and connect evidence explicitly. Source review and matching do not verify bank settlement or create recovered revenue.”

### 0:30–1:00 — Show practice controls

Open **Settings → Organization** (`/dashboard/settings/organization`) and confirm the intended practice. Do any necessary practice setup before recording, including the synthetic practice NPI supplied for the optional call chapter. Open **Settings → Operations** briefly if the actor is an owner/admin; saved work counts may be zero.

**Say:** “Practice access scopes this work. Operations shows saved work and review alerts; external email delivery is unavailable. We’ll return to the audit history after recording the reviews.”

The **Integrations** page offers CSV import and states direct connections are unavailable. The **Notifications** preferences and dedicated **Team** page contain coming-soon states; do not demonstrate them as completed controls.

### 1:00–1:50 — Import the two claims

1. Open `/dashboard/claims/import` (the **Upload claims CSV** screen).
2. Set **Source database** to `synthetic-demo-office` exactly.
3. Click **Choose CSV**, select `claims.csv`, then **Upload claims**.
4. Confirm two imported claims, or “Unchanged” if this exact bundle was already imported. Open **Claims** and `DEMO-CLAIM-A`.
5. Inspect **Imported procedures and coverage**: Open Dental, source database, original claim ID and the source line. The imported billed amount is $200. Claim B’s billed amount is $160.

**Say:** “The original source identity and procedure line are preserved. These are billed amounts and source observations. Imported coverage does not prove eligibility or payment.”

If including the optional synthetic call chapter, do it **now**, then return here. Wait until any call and analysis work has finished before beginning the financial reviews. Reopen the claim after a version change.

### 1:50–2:50 — Review both claim remittances

For claim A, choose `remittance-a.json` using **Import remittance JSON**, then click **Import evidence**. Open **Open fresh preview** (or the saved row’s **Open preview**). Check the source record and exact line mapping, the reported $100 amount, and the preview’s blockers. Click **Accept reported evidence** only when the preview permits it.

Repeat on claim B with `remittance-b.json` and its $80 report. Use the claim links/list to navigate; do not paste guessed internal IDs.

**Say:** “These two accepted reports total $180. Acceptance includes the reports in local reviewed totals. It does not confirm cash, posting or settlement, and it does not submit a claim.”

If a report is imported into the wrong claim, stop and inspect the mapping error. Do not change its source identity to force acceptance.

### 2:50–3:35 — Review the remittance batch

Open **Remittance batches** (`/dashboard/remittance-batches`). Choose `batch.json`, click **Import batch source**, then **Open fresh batch preview** or **Open preview** on its saved row.

Confirm the original batch ID `demo-batch`, both explicitly referenced accepted reports, the **separate source header totals and listed sums**, and provider adjustment −$30. The arithmetic is **$100 + $80 − $30 = $150**. Inspect the original adjustment amount, sign convention, reference and raw adjustment code without recoding it. Click **Accept batch evidence**.

**Say:** “The batch net is $150 after a provider-level adjustment. We preserve the adjustment as its own source fact. We don’t subtract it from either claim or turn the batch into a cash receipt.”

### 3:35–4:15 — Review the account source observation

Open **Cash evidence** (`/dashboard/cash-evidence`). Select `cash.json`, click **Import source revision**, then **Open fresh source preview**. For an already imported record, use **View source history** and **Open preview** on the required sequence.

Confirm `demo-bank-transaction`, the source account, source sequence, reported status, original amount/sign convention and signed +$150. Click **Accept source revision**.

**Say:** “This is a manually imported account-source observation. Acceptance does not establish a verified bank transaction or settlement. Account identity stays attached to it.”

### 4:15–5:10 — Reserve $100, then the remaining $50

Open **Cash reconciliation** (`/dashboard/cash-reconciliations`). Select the reviewed cash transaction and current accepted batch from the supplied lists. Check their source IDs and account; the screen does not infer a match from a trace reference.

1. Enter `100.00` in **Signed match amount (USD)**. Click **Open fresh match preview**. Confirm available magnitudes of $150 before this match, then **Record reviewed match**.
2. Select the same sources again if necessary. Enter `50.00`, open another fresh preview and confirm **already reserved $100 / available $50** for both sources. Click **Record reviewed match**.
3. Show both current matches in history. Do not describe the two amounts as allocations to claims A and B.

**Say:** “These are two reviewed reservations against the same $150 cash source and batch net. They prevent overuse of capacity. They do not move money, combine accounts, verify settlement or allocate cash to a claim.”

### 5:10–6:50 — Review posting facts and exact claim associations

Open **Posting evidence** (`/dashboard/posting-evidence`). Choose `posting.json` under **PMS payment receipt JSON**, click **Import source revision**, then **Open fresh source preview**.

Show the facts separately: header +$150, known listed entry subtotal +$180, complete entry amount +$180 and header difference −$30. Inspect the PAYMENT and TRANSFER entry kinds, original signs, dates, raw flags and IDs. This complete but mismatched receipt is reviewable as a source observation; click **Accept source revision** if its server checks permit.

**Say:** “The receipt header and its listed entries disagree by $30. We retain both facts. Acceptance neither balances that difference away nor posts $180 to local claims. A source transfer flag does not establish a bank transfer.”

In **Claim associations**, click **Inspect exact claim candidates**:

1. On the payment entry, click **Preview association**. Confirm the direct link to `DEMO-CLAIM-A`, source claim `demo-claim-a`, line `demo-line-a` and procedure `demo-procedure-a`. Click **Record claim association**.
2. Inspect candidates again. On the transfer entry, click **Preview association**. Confirm `DEMO-CLAIM-B` and the **claim-only association** text. No source line is associated; `demo-unresolved-procedure-b` remains a raw unresolved reference. Click **Record claim association**.
3. Show **Current association** history. The immutable receipt’s raw references remain labeled unlinked in that source snapshot; these separate reviewed associations provide the local links.

**Say:** “The first association uses exact imported claim and line identities. The second is claim-only because the source supplies no line ID. Neither association posts a payment, establishes recovered revenue or allocates cash. Source verification, bank verification and settlement remain unverified.”

### 6:50–7:40 — Close with audit and scope

Open **Settings → Audit log** (`/dashboard/settings/audit-log`). Use **From Date** and **To Date**, leaving **All Resources** selected to include financial-evidence events. **Resource Type** currently offers only the listed claim/call/summary/organization categories. Open a relevant row to inspect the saved metadata. Show events actually present for these imports, reviews and relationships; do not promise an event name or count that the page does not show.

Optionally return to **Operations → Review notifications**. With no call/analysis chapter, an empty list is expected. When rows exist, use **Notification status**, **Inspect**, and the exact linked claim/call where available. A synthetic receipt, a provider-accepted receipt and delivery to an inbox are different outcomes; this surface has no send, retry or recipient-rebind action.

**Say:** “The saved history lets a reviewer see what was imported and decided. We have reviewed reports, source observations and explicit relationships—not a verified bank balance, a posted local payment or recovered cash.”

## Optional chapter A — Current synthetic Call now workflow

Insert this chapter immediately after CSV import, before all remittance and posting reviews. Allow extra time for the asynchronous scenario; do not promise a fixed call outcome or duration.

Prerequisites must be rehearsed separately:

- The local runtime must use the current durable call/job path and a verified fake adapter. `RETELL_API_KEY` must be absent and `DEMO_AUTOPILOT=true`; no real phone call is authorized by this guide. A fake adapter without demo autopilot does not by itself prove the whole scenario completes.
- New analysis uses `SUMMARY_ANALYSIS_PROVIDER=SYNTHETIC` and `DEMO_SUMMARIZER_FALLBACK=true`, with live provider credentials absent. Do not enable paid providers or promote a model release for this demo.
- This guide’s strict preflight requires **inline** job dispatch, the local internal API origin and its shared secret. Verify that the guarded launch runs the current durable job path; do not add BullMQ workers, Redis or SQS, and do not assume that opening the browser alone processes work.
- The practice must have the configured synthetic demo NPI and the claim must have a supported payer and queueable state. `DEMO_IGNORE_PAYER_HOURS=true`, if deliberately configured for the fake demo, only bypasses payer-hours checks when live telephony is absent.
- **Findings and evidence requires a non-null active Clerk organization in the UI.** This guide’s preflight requires a real `org_…` binding, but still cannot verify which organization is active in the browser. Confirm it after sign-in. A no-organization session displays “Select your practice to see findings”; do not bypass it.

Open `DEMO-CLAIM-A` and use **Call now**. If the screen instead shows **Add NPI**, **Review call**, a current call or a blocked state, follow that state rather than forcing another submission. Open **Calls** and the corresponding call detail. Show saved status, transcript and analysis status as they arrive. Use the existing status/recovery controls only after inspecting their preview; do not start the old simulator or fabricate terminal events.

**Say:** “This call and its analysis are simulated locally through the application’s durable workflow. No payer is being dialed and no paid model or external email is being used. A summary is a reported finding, not payment verification.”

On the claim’s **Findings and evidence**, click **Refresh findings**. If **Add saved findings** appears, it publishes already saved analysis for review; it is not a new call or model request. Inspect the finding and its transcript evidence. Use **Mark reviewed**, or **Dismiss finding** with its required review note, only when the shown finding is reviewable. Stale findings remain history. Regeneration is a separate approved workflow; omit it unless its preview, authority and synthetic runtime were separately rehearsed.

After the call and analysis settle, refresh the claim and proceed with the financial walkthrough using fresh previews. Any later claim edits or new calls can stale earlier evidence or associations; do not stage them after the financial chapter and then imply everything stayed current.

## Optional chapter B — Correct the batch and explicitly release reservations

Run only after both $100 and $50 matches exist. Open **Remittance batches**, import `batch-correction.json`, and inspect **View revision history** for the same `demo-batch` identity.

The v1 file is the unsequenced baseline. The correction is a v2 observation with a new record ID, source sequence 1, unchanged member reports, provider adjustment −$40 and net $140. The latest observed revision makes the older accepted revision stale even before acceptance. Open a fresh preview and **Accept batch evidence** when permitted. The membership comparison retains both reports; omissions in a correction would retain their historical ownership, not free them for another batch. Zero is an amount, not a deletion instruction.

Return to **Cash reconciliation**, click **Reload batch sources** and **Reload matches**. The two old matches remain reserved across the batch revision and are stale; accepting the correction did not release $150. A new match to the $140 revision is blocked while those earlier reservations remain.

For **each** old match, click **Review full release**, choose the truthful **Source evidence changed** reason, **Open fresh release preview**, then **Release full match**. Release the whole $100 match and the whole $50 match; there is no partial-release shortcut. Show the preserved released history.

Only then preview a new `140.00` match against the current corrected batch and original +$150 cash source. If recorded, $10 of that account-source capacity remains unused. This is not a $10 claim balance or a refund.

**Say:** “A correction changes the current batch facts, not the old review history. Reservations survive until an explicit full release. The corrected net is $140; we never silently overwrite, net away, or move the earlier matches.”

Posting associations are independent. A batch correction alone does not demonstrate a posting-source or claim-version change. Their own **Review full release** → **Reason for full release** → **Open fresh release preview** → **Confirm full release** flow should be used only for a separately reviewed association error or source change; this bundle does not include a posting revision to stage that scenario.

## Recovery and repeat rehearsals

- **Uncertain response:** stay in the same practice and use the displayed **Retry same import**, **Retry same review**, **Retry same match**, **Retry same association** or **Retry same release** action. It preserves the original request. Do not change the source IDs, refresh into a different decision or submit a second “replacement” request to make the uncertainty disappear.
- **Changed/stale preview:** inspect the changed source or claim, then explicitly open a fresh preview. A refusal is a demo result worth explaining, not a cue to remove the check.
- **Previously imported files:** exact imports can replay, but accepted/rejected reviews and recorded relationships remain history. Repeat uploads are not a reset. Reuse their history for a recorded explanation, or prepare a separately scoped clean demo workspace before another full rehearsal.
- **Missing candidate:** compare source system, namespace and original claim/line/procedure IDs. Unsupported or unresolved references must remain unresolved. Do not invent a local claim mapping or infer one from amounts, payer names or payment traces.
- **History unavailable:** show the error and retry the read; do not describe unavailable state as empty or completed. Read all required pages before narrating a total.
- **Auth mismatch:** stop and verify the Clerk session, intended practice and local actor binding. Do not add test headers to the browser or reset the database as an auth workaround.

## Recording handoff and remaining work

Before recording, mark these complete with actual evidence:

- [ ] Scoped read-only preflight command/result recorded; intended local database and synthetic actor verified.
- [ ] Real Clerk sign-in, local actor binding and correct owner/admin practice confirmed in the dashboard.
- [ ] Local API/web (and optional synthetic call runtime) launched with no unintended live adapters.
- [ ] Connected bundle imported and this exact screen order rehearsed against the real authenticated dashboard.
- [ ] Any optional call/findings prerequisites and outcomes checked; omitted chapters identified honestly.
- [ ] Presenter records the core walkthrough, with synthetic-data disclosure visible/spoken and credentials/private browser content kept outside the frame.
- [ ] Presenter supplies the actual recording plus a poster frame, captions/transcript and chapter timestamps. No filename, duration or transcript is treated as final until that asset exists.
- [ ] Landing-page integration is implemented and verified after the asset is approved, with user-controlled playback, readable mobile layout and an accessible text alternative. The existing illustrative `ClaimDemo` is not a screen recording.

No launch, authenticated rehearsal, recording, asset delivery or landing-page publication is asserted by this document.
