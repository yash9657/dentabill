# Synthetic remittance batch evidence

These files are fabricated custom version 1 contracts for local development. They
are not native 835 files, payer exports, PMS receipts, bank records, or proof that
an external integration works. No real patient, provider, or account data appears
in them. Source names and unknown adjustment codes are retained as supplied; no
standard adjustment-code interpretation is asserted.

Import each file with `POST /v1/remittance-batches`, obtain a fresh
`GET /v1/remittance-batches/:id/preview`, then submit an explicit review to
`POST /v1/remittance-batches/:id/review` using its token and a new idempotency key.
An uncertain response must be retried with the identical decision, token and key.
These actions retain evidence only. Cash receipt, posting and settlement remain
unverified after acceptance; no money moves and no claim amount changes.

The source identity is the explicit namespace/batch ID. The independent record ID
also cannot be reused with changed content. A shared document or payment trace
does not establish batch membership. Importing the exact same record is a replay;
corrections and source revisions are not supported by this slice.

| Fixture                         | Required accepted claim reports                                      | Source arithmetic                                 | Expected review                                                |
| ------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| `01-balanced-180-minus-30.json` | `synthetic-claim-report-100` = 100; `synthetic-claim-report-80` = 80 | 180 + (-30) = 150                                 | Acceptable when both exact members are available and unbatched |
| `02-partial-unknown.json`       | Only the 100 report is listed                                        | Adjustment and net totals unknown; detail partial | Acceptance blocked; rejection allowed                          |
| `03-zero-net.json`              | The 100 report                                                       | 100 + (-100) = 0                                  | Acceptable with exact member binding                           |
| `04-negative-net.json`          | The 100 report                                                       | 100 + (-125) = -25                                | Acceptable; preserves the signed source net                    |
| `05-provider-only-credit.json`  | None                                                                 | 0 + 15 = 15                                       | Acceptable without invented claim members                      |
| `06-signed-reversal.json`       | The 100 report and its accepted `synthetic-claim-reversal-35` = -35  | 100 - 35 - 5 = 60                                 | Acceptable with both signed source members                     |

All member references use namespace `synthetic-remittance`. Seed those claim
remittances through the existing claim-remittance API and explicitly accept them
first. The reversal must refer to the accepted 100 report on the same claim.
The API tests create these prerequisites with absent procedure detail; the test
does not pretend to establish procedure allocation or native remittance parsing.

Run these examples in separate synthetic ledgers or use fresh member identities:
an accepted claim remittance is permanently bound to one accepted batch. The
100 + 80 reports remain 180 in gross claim evidence while the batch net is 150.
Do not allocate 180 from 150, copy 150 onto each claim, or describe the reported
150 as verified cash. Provider adjustments are independent source facts, with
their original amount and sign convention retained alongside the canonical net
effect (`REDUCTION_POSITIVE` negates the source amount).
