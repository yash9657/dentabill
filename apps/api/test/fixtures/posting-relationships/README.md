# Synthetic posting relationship fixtures

All identifiers, patient demographics, procedures, amounts and dates are fabricated. These are custom manual inputs, not authenticated Open Dental exports or connector evidence.

1. Import `source-claims.csv` using source database name `synthetic-relationships`. The two distinct source claims deliberately share a display number. Each has two D2740 procedures with distinct source line/procedure IDs.
2. Import and review `01-header150-entries180.json` in posting evidence. Its header150 differs from entries100+80; acceptance preserves both without balancing them.
3. Review each exact entry-to-claim/line relationship. The posting references identify `claim-a`, `line-a`/`line-b` and their respective procedure IDs. The duplicate display number and repeated procedure code are not matching keys.

Tests derive unknown amounts, negative transfers, claim-only references, changed revisions and removals from this base. Relationships only associate source facts with local records. They do not post a payment, allocate bank cash, change claim workflow, verify settlement or establish recovered revenue. Existing `posting-evidence` fixtures use `SYNTHETIC_PMS` intentionally; that unsupported source system must not resolve imported claim targets.
