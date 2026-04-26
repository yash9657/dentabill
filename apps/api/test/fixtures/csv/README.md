# Sample CSV fixtures

Three synthetic claim exports — one per supported source system —
used by the CSV ingestion tests (P2-T49). All names, IDs, and DOBs
are fabricated; **no real patient data is committed here**.

| File                    | Source      | Header style                         | Row count |
| ----------------------- | ----------- | ------------------------------------ | --------- |
| `dentrix-sample.csv`    | Dentrix     | Title-Case with spaces               | 10        |
| `eaglesoft-sample.csv`  | Eaglesoft   | CamelCase, US-style dates, $-amounts | 10        |
| `opendental-sample.csv` | Open Dental | TitleCase, ISO dates                 | 10        |

Each file intentionally includes:

- A row with a **multi-procedure** field (separator: comma in
  Dentrix, semicolon in Eaglesoft, space in Open Dental — matches
  what each tool actually emits).
- A row with **no submission date** (CSV blank) so the parser
  must distinguish "missing" from "empty string".
- A row whose insurance carrier text is a **near-match** that
  exercises `resolvePayerCode` (e.g. `DELTA DENTAL OF CA - PPO`,
  `MetLife`, `Tricare Dental`).
- A row with an **unrecognised payer** that must fall through to
  `UNKNOWN` with the original label preserved.

The three files share row 1's logical patient (DOB 1990-05-12,
Delta Dental PPO, $1240, service date 2026-01-08) so cross-format
property tests can assert that `hashPatientDOB` produces the same
digest regardless of source.
