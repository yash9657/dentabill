# Sample CSV fixtures

These are DentaBill synthetic test layouts for Dentrix, Eaglesoft and Open Dental.
All names, IDs and dates are fabricated. They are not captured customer exports or
proof of a supported PMS connector.

Each has ten rows, including multiple procedure codes, a missing submission date,
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

Legacy binding, reviewed source updates, recurring PMS sync and procedure/payment
modeling remain follow-on work. Current imports do not update reviewed claims or
establish financial settlement.
