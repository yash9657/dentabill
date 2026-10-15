# DentaBill synthetic walkthrough and recording guide

This guide rehearses the implemented dashboard with a small, connected set of invented records. The core walkthrough takes about **7–8 minutes after sign-in**. Optional call, correction and recovery chapters are separate.

**2026-10-14 rehearsal checkpoint (ADR-085):** the actual local app authenticated through an official short-lived Clerk development ticket. Bearer-token `/v1/me` returned 200 for the exact local OWNER without test headers. The UI imported two claims and completed a 39-second synthetic call with readable conversation and a pending legacy summary: Denise, reference `REF-SIM-DELTA-001` and **Call back**. The claim remains **Manual review**, no native observation exists, and live IVR-navigation/human-contact flags remain false.

The actual UI sequence covered reports of $100 + $80, batch net $150 after a $30 provider adjustment, cash $150, matches of $100 + $50, posting header $150/entries $180 and exact-line A/claim-only B associations. Correction to $140 staled and blocked prior reservations; full releases then rematch $140 left cash capacity $10 and batch capacity $0. Database proof corroborates the sequence. These synthetic reviews do not establish live connectors, settled cash or recovered revenue.

There are 205 distinct passing focused cases across separate runs, an overlapping 24-case recheck, 30/30 final affected lint/type checks and passing API/isolated Next builds. Actual authenticated call/audit desktop/mobile/drawer QA passes without overflow, page errors or WCAG axe violations. The created Clerk session is revoked, owned services/private test and build runtimes are cleaned up, and the local rehearsal database is preserved.

Raw capture is complete at 1440×900, VP8, 25fps and 1242.24s, with 11 additional review shots. Keep raw footage outside public assets. The edited/captioned final video, poster/transcript package and landing-page integration are still to be produced. Next is the ADR-085 checkpoint commit followed by that media work; this does not complete FW-45 or the full implementation plan.

## Prepare the local workspace

Use a dedicated local database named `dentabill_demo_<run>` and an authenticated synthetic practice with a real Clerk development organization. Keep production data and credentials out of the recording.

- Use the repository’s pinned pnpm version (`pnpm@10.33.0`) and supported Node version (`>=20.19`). Install with `pnpm install --frozen-lockfile` when needed.
- Install the pinned workspace dependencies. The create-only setup command below creates a fresh local database and applies the checked-in migrations. Setup and preflight each generate a temporary private Prisma client; neither resets or replaces an existing database.
- Configure a real Clerk development session for the browser and corresponding API keys. The API startup output must say `auth mode: clerk`. Browser requests obtain a Clerk bearer token; `x-test-user-id` and `x-test-org-id` are integration-test facilities, **not browser sign-in**.
- Confirm that the actual Clerk `user_…` and active `org_…` map to the intended local DentaBill user and organization. The preflight requires **OWNER or ADMIN**, one practice and one actor in this isolated database, and an exact real Clerk organization binding; `local_*` bindings are not accepted for this recording setup. Use the top-bar organization switcher to select that practice after sign-in. Sign-in alone does not create or verify the local binding.
- Configure the local web/API origins consistently, including the web `NEXT_PUBLIC_API_URL`. The usual development URLs are `http://localhost:3000` and `http://localhost:3001`; use the configured ports if different.
- Keep telephony, paid model, billing and external email delivery disabled. The optional call chapter needs the separately verified synthetic runtime described below; the core financial-review chapter does not need a call.

### Demo configuration

Supply the configuration explicitly in the command environment. Preflight stages a private Prisma client with no configured dotenv paths and bundles its application code into a temporary runtime; generation, bundling and execution each receive an explicit environment. The temporary runtime is removed afterward. Keep actual secrets in your approved local secret mechanism and out of terminal recordings or this document. Use the trusted installed Node/pnpm toolchain and remove preload, module-path, bundler-binary and debug overrides before invocation; checks inside the command cannot undo code already executed by its launcher.

| Configuration                                                           | Required value or constraint                                                                                                                                                                  |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                          | Local PostgreSQL (`localhost`, `127.0.0.1` or `::1`), database `dentabill_demo_<run>`. Setup requires a new name; preflight requires current migrations and only the intended practice/actor. |
| `NODE_ENV`                                                              | `development`                                                                                                                                                                                 |
| `NEXT_PUBLIC_APP_URL`                                                   | Local HTTP web origin, typically `http://localhost:3000`.                                                                                                                                     |
| `NEXT_PUBLIC_API_URL`                                                   | A different local HTTP API origin, typically `http://localhost:3001`.                                                                                                                         |
| `INTERNAL_API_BASE_URL`                                                 | Exactly the API origin.                                                                                                                                                                       |
| `API_CORS_ORIGINS`                                                      | Omit it or set only the web origin.                                                                                                                                                           |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`                 | Actual matching Clerk development-instance test keys (`pk_test_…` / `sk_test_…`). Optional `CLERK_PUBLISHABLE_KEY` must equal the web publishable key.                                        |
| `INTERNAL_JOB_SECRET`, `DOB_HASH_SECRET`                                | Nonempty locally supplied secrets of at least 32 / 16 characters respectively.                                                                                                                |
| `JOB_DISPATCH_MODE`                                                     | `inline`                                                                                                                                                                                      |
| `SUMMARY_ANALYSIS_PROVIDER`                                             | `SYNTHETIC`                                                                                                                                                                                   |
| `SUMMARIZER_AUTO_TRANSITION_ENABLED`                                    | `false`                                                                                                                                                                                       |
| `DEMO_AUTOPILOT`, `DEMO_IGNORE_PAYER_HOURS`, `DEMO_SUMMARIZER_FALLBACK` | Each exactly `true`.                                                                                                                                                                          |

Remove inherited live-service configuration from this dedicated process environment. Preflight refuses nonempty Retell, Fireworks, Anthropic, OpenAI, Stripe, mail, AWS, Vercel/Railway, Telnyx/Twilio, ElevenLabs, Upstash and Sentry settings; it also refuses Redis/SQS URLs, model-release selectors, the Clerk webhook secret, `NODE_OPTIONS`, `NODE_PATH`, `ESBUILD_BINARY_PATH`, `DOTENV_CONFIG_PATH` and `DEBUG`. Clerk test authentication is the intentional external service. A presence/format check of its keys is not proof that authentication succeeds.

### Create the local demo practice

Choose a new admitted database name and the actual intended Clerk development organization/user. The local database role must have permission to create a database; the command connects to the same local server's `postgres` maintenance database with those credentials.

From the repository root, with the explicit configuration supplied, run:

```bash
pnpm --filter @dentabill/api exec tsx scripts/demo-provision.mts \
  --organization-id '<local-organization-id>' \
  --user-id '<local-user-id>' \
  --clerk-organization-id 'org_REPLACE_WITH_ACTUAL_ID' \
  --clerk-user-id 'user_REPLACE_WITH_ACTUAL_ID'
```

Replace every placeholder with the intended binding. The command verifies the bundle, stages the exact migration bytes in its private runtime, creates the database, applies those migrations, and atomically adds one synthetic practice, one OWNER, a Delta Dental PPO configuration and one `demo.provisioned` audit. The practice/payer NPI is the synthetic `9999999999`; the owner's local display email is `demo-operator@example.test`. No claims, calls, financial evidence, inference or billing records are seeded. Import the bundle through the app during rehearsal.

Success prints `PROVISIONED` with the provisioning UUID, exact actor binding, audit ID, manifest hash and migration digest/count. Save that JSON receipt with your local setup notes. Authentication, authenticated rehearsal and recording remain `NOT_VERIFIED`; creating local rows does not authenticate the browser or change Clerk membership.

An existing database is always refused, including a repeat with identical actor arguments. There is no reset, resume or rebind option. A failure preserves any created database and reports its phase and state:

| `databaseState`          | Meaning                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `NOT_CREATED`            | This run did not create a database, or creation was explicitly rejected.                |
| `EXISTING_UNCHANGED`     | The target already existed or another creator won; this run did not migrate or seed it. |
| `CREATED_PRESERVED`      | Creation was acknowledged; the failed run kept the database for inspection.             |
| `CREATE_OUTCOME_UNKNOWN` | The creation response was uncertain; the target may exist.                              |
| `OUTCOME_UNKNOWN`        | A child-process or reporting failure obscured the result; work may have completed.      |

Inspect the named database and receipt before further action. Do not treat a lost response as a failed creation or an invitation to reset data. A different fresh database name starts an independent run; the prior database remains preserved. Read-only preflight can verify a completed binding, but cannot repair a partial migration or seed.

### Read-only preflight

With the same explicit configuration and actor identifiers, run:

```bash
pnpm --filter @dentabill/api exec tsx scripts/demo-preflight.mts \
  --organization-id '<local-organization-id>' \
  --user-id '<local-user-id>' \
  --clerk-organization-id 'org_REPLACE_WITH_ACTUAL_ID' \
  --clerk-user-id 'user_REPLACE_WITH_ACTUAL_ID'
```

Replace every placeholder with the intended actor’s actual identifiers. Success prints `PREFLIGHT_PASSED`, `readOnly: true` and the migration count/actor role, while authentication, authenticated rehearsal and recording remain explicitly **not verified**. It checks local configuration, the bundle, migrations and database bindings in a read-only transaction. It does not start servers, create an actor or practice, apply migrations, upload records, contact Clerk to validate membership, or record a video. A failure returns a closed reason code; fix the named prerequisite rather than weakening the guard.

### Launch the app

Keep the same explicit configuration and actor arguments. The web URL must use `http://localhost:<port>`; the API may use any admitted loopback host. The launcher refuses a web IP literal because the pinned Next/Clerk combination can turn its normalized localhost rewrite into a routing loop. It never silently rewrites your configured origin. The app and API must use different, nonzero ports. From the repository root, run:

```bash
pnpm --filter @dentabill/api exec tsx scripts/demo-launch.mts \
  --organization-id '<local-organization-id>' \
  --user-id '<local-user-id>' \
  --clerk-organization-id 'org_REPLACE_WITH_ACTUAL_ID' \
  --clerk-user-id 'user_REPLACE_WITH_ACTUAL_ID'
```

The launcher repeats read-only preflight in the API's private runtime before listening. It stages a private physical copy of the web app, its public assets and shared UI styles, excluding dotenv files, caches and test artifacts. Next receives only the selected local URLs and Clerk test configuration; it receives no database or job secrets. Both services bind to the configured loopback origins. An occupied port fails the launch instead of selecting a different port or stopping another server. The installed workspace dependencies remain trusted and linked; this copy is not an independent dependency snapshot.

Wait for `SERVICES_RUNNING`, then open its `appOrigin`. That status confirms owned server startup, API readiness and the served demo manifest hash. It does **not** establish Clerk sign-in, active organization or a successful walkthrough: authentication, authenticated rehearsal and recording remain `NOT_VERIFIED`. The first page compilation may download Google Fonts; allow it to complete before rehearsal. Child logs are suppressed, and startup failures report a fixed reason code without credentials or record contents.

Leave the command running while rehearsing or recording. Press **Ctrl+C** to stop its owned API/web processes and remove their private runtime folders. The demo database and all saved reviews are preserved. `STOPPED` reports whether the supervisor sent a forced termination (`forcedBySupervisor`); children also have their own shutdown deadlines, and this status does not certify graceful completion of in-flight work. Wait for fake calls and analysis to finish in the app before stopping. `DEMO_CLEANUP_UNCONFIRMED` means the launcher could not confirm process or temporary-folder cleanup; it preserves runtime folders if owned processes may still be active.

Do not treat raw `pnpm dev`, inherited `.env` files or dotenv symlinks as this isolated launch path. Do not substitute the legacy seed or simulator for a missing prerequisite. Before recording, sign in with the intended Clerk development user, select the matching organization, verify `/v1/me` resolves that exact local actor, and complete the walkthrough once in the actual browser. The ADR-085 checkpoint above completed this authenticated rehearsal; every new session or practice binding still needs the same checks.

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

Open **Settings → Audit log** (`/dashboard/settings/audit-log`). Use **From Date** and **To Date**, leaving **All Resources** selected to include financial-evidence events. **Resource Type** currently offers only the listed claim/call/summary/organization categories. Open a relevant row to inspect the saved metadata. Show events actually present for these imports, reviews and relationships; do not promise an event name or count that the page does not show. Current financial actions have verified actor attribution. Older rows with no stored actor correctly say **Actor not recorded**; do not narrate them as system actions or rewrite history to fill the gap.

Optionally return to **Operations → Review notifications**. With no call/analysis chapter, an empty list is expected. When rows exist, use **Notification status**, **Inspect**, and the exact linked claim/call where available. A synthetic receipt, a provider-accepted receipt and delivery to an inbox are different outcomes; this surface has no send, retry or recipient-rebind action.

**Say:** “The saved history lets a reviewer see what was imported and decided. We have reviewed reports, source observations and explicit relationships—not a verified bank balance, a posted local payment or recovered cash.”

## Optional chapter A — Current synthetic Call now workflow

Insert this chapter immediately after CSV import, before all remittance and posting reviews. Allow extra time for the asynchronous scenario; do not promise a fixed call outcome or duration.

Prerequisites must be rehearsed separately:

- The local runtime must use the current durable call/job path and a verified fake adapter. `RETELL_API_KEY` must be absent and `DEMO_AUTOPILOT=true`; no real phone call is authorized by this guide. A fake adapter without demo autopilot does not by itself prove the whole scenario completes.
- New analysis uses `SUMMARY_ANALYSIS_PROVIDER=SYNTHETIC` and `DEMO_SUMMARIZER_FALLBACK=true`, with live provider credentials absent. Do not enable paid providers or promote a model release for this demo.
- This guide’s strict preflight requires **inline** job dispatch, the local internal API origin and its shared secret. Verify that the guarded launch runs the current durable job path; do not add BullMQ workers, Redis or SQS, and do not assume that opening the browser alone processes work.
- The practice must have the configured synthetic demo NPI and the claim must have a supported payer and queueable state. `DEMO_IGNORE_PAYER_HOURS=true`, if deliberately configured for the fake demo, only bypasses payer-hours checks when live telephony is absent.
- The active Clerk practice must match the preflight’s real `org_…` binding. Preflight cannot verify which organization is active in the browser. Confirm it after sign-in; do not bypass missing-practice or access states.

Open `DEMO-CLAIM-A` and use **Call now**. If the screen instead shows **Add NPI**, **Review call**, a current call or a blocked state, follow that state rather than forcing another submission. Open **Calls** and the corresponding call detail. Rehearse the **Conversation**, **Post-call analysis** and **Collected call details** sections before recording; their presence and content must be verified in the actual authenticated browser. Use existing status/recovery controls only after inspecting their preview; do not start the old simulator or fabricate terminal events.

The current runtime uses a payer-matched, scripted pending-review scenario. Its conversation includes the synthetic practice, subscriber ID and service date, a simulated representative and a synthetic reference number. Show the saved speaker-labeled turns and the resulting **Reported outcome**, **Reference number**, **Representative** and **Suggested next action**. The saved next action is **Call back** while the claim workflow remains **Manual review**; these are separate fields. The summary contains no approved payment amount. A provisional conversation must remain labeled provisional until the final transcript is available.

**Say:** “This is a simulated call and offline analysis. The script illustrates collecting claim information and recording a reference for review. No payer is dialed, no audio or DTMF tones are generated, and no paid model or external email is used.”

The IVR greeting, menu choice and hold are **scripted transcript text**, not evidence of actual telephone navigation, voice recognition or audio playback. Do not add payer audio, keypad sounds or a waveform that suggests those actions occurred.

This synthetic path saves the legacy `CallSummary` and leaves the claim in `MANUAL_REVIEW`; it does **not** create a native `ClaimObservation`. Do not demonstrate **Add saved findings**, **Mark reviewed**, **Dismiss finding** or native observation regeneration as an outcome of this call. An empty **Findings and evidence** section is not a missing step to repair. The saved summary and conversation are the supported call demonstration; the subsequent financial imports and reviews remain separate source evidence, not results caused by this simulated conversation.

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

## Landing-page cut: about 3 minutes

Proposed title: **From claim to clear next step.** Follow one billing coordinator and the two connected synthetic claims. This is an edited showcase plan, not a completed recording. Keep a small **Synthetic demo** label visible throughout and **Simulated call and analysis** during the call chapter. Use only actual captured screen states after rehearsal; label skipped asynchronous waiting rather than implying an instant result.

| Time      | Actual screen and focus                                                                                                             | Suggested narration                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:12 | Signed-in practice and **Claims**                                                                                                   | “Follow a claim from import to a documented next step.”                                                             |
| 0:12–0:35 | **Upload claims CSV**, then the imported claim and procedure/source identity                                                        | “Keep the original claim, procedure and source identity together.”                                                  |
| 0:35–1:05 | **Call now**, call status/event log and **Conversation**                                                                            | “This scripted simulation illustrates collecting claim information through the follow-up workflow.”                 |
| 1:05–1:30 | **Post-call analysis → Collected call details**: pending outcome, representative, synthetic reference and **Call back** next action | “The conversation and saved summary give the practice a record to inspect. This example still needs manual review.” |
| 1:30–2:03 | Reviewed claim remittances and **Remittance batches** preview                                                                       | “Separate imported reports total $180. A $30 provider adjustment makes the batch net $150.”                         |
| 2:03–2:38 | **Cash reconciliation** reservations of $100 then $50; **Posting evidence** header/entry difference and exact association           | “Review each relationship explicitly. Preserve differences instead of silently balancing them away.”                |
| 2:38–2:55 | Relevant **Audit log** rows and preserved review history                                                                            | “Keep source facts, decisions and their history connected.”                                                         |
| 2:55–3:00 | Claim or evidence screen with a restrained closing title                                                                            | “Follow up. Review evidence. Keep control.”                                                                         |

Use focused cuts rather than showing every file picker or scrolling past unreadable data. The call chapter must finish before financial reviews, and the edit must not imply that the call produced the remittance, cash or posting evidence. Do not show native findings review, live connectors, coming-soon Team/Notifications controls, paid-model analysis, verified settlement or recovered-money metrics as demonstrated capabilities. Operations can appear briefly when there is relevant saved work; external notification delivery stays unavailable.

Keep the existing **7–8-minute financial walkthrough** as the detailed companion. Add the call/conversation chapter at its actual rehearsed length, and use the optional correction/full-release chapter to explain stale evidence and retained reservations. Final duration, captions and chapter timestamps must come from the recording that is actually produced.

## Recording handoff and remaining work

Current evidence and remaining delivery work:

- [x] Guarded isolated launch used the intended local database and exact Clerk/local actor binding.
- [x] Real Clerk sign-in, exact local OWNER binding and intended practice confirmed through the actual browser and bearer-token `/v1/me`.
- [x] Local API/web and the explicitly synthetic call runtime launched; no live payer/paid-model/billing/mail adapter was used.
- [x] Connected bundle and correction/release chapter completed through the real authenticated dashboard; database proof corroborates saved results.
- [x] Call/conversation/saved-summary outcomes checked: pending/CALL_BACK summary, MANUAL_REVIEW claim, no native observation and false live-navigation/contact flags.
- [x] Raw UI capture collected for the rehearsed sequence. Editing, disclosure/caption review and final credential/private-content inspection remain part of delivery.
- [x] Actual authenticated call and audit desktop/mobile/drawer QA passes without overflow/page errors or WCAG axe violations.
- [x] Audit API 11/11 and final web 47/47 pass, for 205 distinct milestone cases across separate runs.
- [x] Final affected lint/type checks pass 30/30; API and isolated Next production builds pass. The 24-case recheck adds no distinct cases.
- [x] Created Clerk session revoked and owned services stopped, with the rehearsal database preserved.
- [x] Private Next build runtime and remaining owned test temporary files are cleaned up.
- [ ] Presenter supplies the actual recording plus a poster frame, captions/transcript and chapter timestamps. No filename, duration or transcript is treated as final until that asset exists.
- [ ] Landing-page integration is implemented and verified after the asset is approved, with user-controlled playback, readable mobile layout and an accessible text alternative. The existing illustrative `ClaimDemo` is not a screen recording.

The checkpoint above verifies local authentication, the synthetic UI rehearsal and raw capture. It does not assert final media delivery, landing-page integration/publication, production deployment or full-plan completion.
