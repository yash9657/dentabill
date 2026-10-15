# Sample CSV fixtures

These are DentaBill synthetic test layouts for Dentrix, Eaglesoft and Open Dental.
All names, IDs and dates are fabricated. They are not captured customer exports or
proof of a supported PMS connector.

The three original summary fixtures each have ten rows, including multiple procedure codes, a missing submission date,
payer aliases and an unknown payer. The original payer text is preserved for change
detection. Procedure lists are still claim-level summaries; they do not represent
procedure quantities, teeth, surfaces, coverage or payments.

## Importing and repeating an upload

Use the dashboard’s **Source database** field, for example `practice-main`. Keep
that same name for every export from that database; use a different name for a
separate database. Names use 1–80 lowercase letters, numbers, hyphens or underscores,
starting with a letter or number. This is an operator-declared namespace, not verified
PMS account identity. Changing it creates a separate identity scope.

Every new row needs an original stable source record ID in `SourceClaimId`.
Open Dental also accepts `ClaimNum`, its internal record ID. The displayed `Claim #`,
Eaglesoft `ClaimNum` and Open Dental `ClaimIdent` are not assumed to be stable source
IDs. Never generate IDs from row numbers, claim numbers, DOB or subscriber IDs in a
real export. These fixture IDs are deliberately synthetic. Optional `SourceVersion`
(or Open Dental `SecDateTEdit`) is retained as an opaque version; it is not ordered.
Open Dental documents `ClaimIdentifier` as semi-unique and `ClaimNum` as the single-record
lookup key: [Claims API](https://www.opendental.com/site/apiclaims.html).

The HTTP endpoint `POST /v1/ingest/claims` requires authenticated access, the
`x-import-source` header containing that database name, and exactly one multipart
`file`. Limits: 10 MB and 5,000 logical data records, including blank records; a
quoted multiline cell is one record. The browser form sends this header and the API
CORS configuration permits it. Old clients without the header must be updated.

| Outcome             | Meaning and next step                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `INSERTED`          | One new claim was saved.                                                                                                   |
| `DUPLICATE`         | The same source identity and exported fields were already imported.                                                        |
| `SOURCE_CHANGED`    | That source identity has different exported fields or version. Compare the existing claim and export; no overwrite occurs. |
| `BATCH_CONFLICT`    | This upload contains conflicting records for one identity. Export one consistent record and retry.                         |
| `LEGACY_MATCH`      | Existing claims without source provenance share the display number. Review them; no automatic binding or merge occurs.     |
| `MISSING_SOURCE_ID` | Supply the actual source ID in the export and retry.                                                                       |

The report includes every parsed row and links an existing claim only when identified
unambiguously. Parser errors are separate and omit raw input. Repeated equal rows in
one file create one claim; conflicting same-ID rows are all withheld. A database
failure rolls back all inserted chunks and the audit together. Lost responses can be
retried with the same file and source database name.

The keyed content fingerprint covers all exported cells, including fields not yet
modeled, so a changed source status cannot silently count as an unchanged record.
Column order and header case do not affect it; changes to cell formatting can cause
a conservative conflict. Raw cells are transient and are never stored in audit/logs.
A change of the DOB hashing secret also changes fingerprints and requires planned
reconciliation, not blind overwriting.

Legacy binding, reviewed source updates, recurring PMS sync and payment
modeling remain follow-on work. Current imports do not update reviewed claims or
establish financial settlement.

## Optional imported procedures and coverage (version 1)

`opendental-source-details-synthetic.csv` is one fake claim with two separately
identified procedure lines and a secondary coverage target. It is a custom DentaBill
layout, not a native Open Dental export. Use the real upload form and any stable fake
source database name to see its imported details on the linked claim page.

All three layouts accept optional `ClaimLines` and `Coverages` columns containing
CSV-escaped JSON arrays. Omitted/blank cells mean details were not supplied; an explicit
empty array is rejected. Either array can be supplied independently. Each supplied array
is complete for that part of this snapshot. Unknown keys or malformed details reject the
whole row; the importer does not fall back to a summary-only record.

`ClaimLines` has 1–500 objects:

- Required: `sourceLineId` (opaque text, max200), `procedureCode` (max32),
  `serviceDate` (real ISO date), `billedAmount` (exact nonnegative USD string with two
  decimals, max `99999999.99`). Amounts are entire line totals and must sum exactly to
  the claim header. The distinct submitted codes must agree with the header code list
  (case-insensitive). Codes are not validated as licensed CDT clinical reference content.
- Optional/null: `sourceProcedureId` (max200), `codeVersion` (max32), `quantity`
  (positive decimal string, up to9 integer/3 fractional digits), `treatmentArea`, `tooth`,
  `surface`, `quadrant`, `toothRange`, `toothNumberingSystem` (each max80).
  Location values are source text, not interpreted tooth-number or surface enums.
- IDs are unique within a claim. Repeated codes, teeth or dates remain distinct lines
  when their source IDs differ. No quantity, location or amount multiplication is inferred.

`Coverages` has 1–9 objects:

- Required: `sourceCoverageId` (max200), `sequence` (integer1–9), `payerName` (max200),
  `isClaimCoverage` (explicit boolean). Both source IDs and sequences are unique within
  the claim; sequence gaps are allowed. Exactly one entry must be the coverage for this
  claim. That entry need not be first in sequence.
- Optional/null: `payerIdentifier`, `sourcePlanId`, `sourceSubscriptionId`, `subscriberId`,
  `patientMemberId`, `groupNumber` (each max200), `payerIdentifierSystem`, `relationship`
  (each max80), `effectiveDate`, `terminationDate` (ISO dates; end cannot precede start).
- Subscriber/member/subscription/plan IDs are separate facts. These entries never fill
  the parent claim’s outbound subscriber ID or establish eligibility/payment.

Text cannot be empty, padded or contain control/format characters. Arrays are bounded at
512 KiB per cell and10,000 accepted procedure+coverage records per upload, in addition to
the existing10 MB/5,000 CSV-record limits. The upload-wide child bound rejects the whole
upload before any write. Dates range from0001-01-01 through9999-12-31.

The parent, sealed snapshot, individual children and audit commit atomically. Stable
DentaBill line IDs are retained on exact reupload. Imported facts cannot be updated,
appended to or individually deleted. Parent claim deletion retains the existing cascade
behavior; this is not an indefinite-retention policy. Current claim edits do not rewrite
the original snapshot or imported total. These rows do not post or reconcile payments.

Details use a versioned fingerprint. If JSON columns were imported before this contract
existed, reupload now reports `SOURCE_CHANGED`; it does not silently enrich or overwrite
reviewed claims. FW-43 will provide reviewed source revisions. Formatting/source changes
also retain the conservative conflict behavior described above.
