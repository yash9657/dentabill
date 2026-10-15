# Synthetic posting evidence fixtures

Every identifier, source reference, amount, date, and status in this directory is fabricated. These version 1 manual PMS receipt observations contain no patient data and are not exports from a real vendor.

- `01-header150-entries180.json`: independent header150 and listed entries100+80. Acceptance preserves the -30 difference without balancing or allocating it.
- `02-partial-entry80.json`: a later partial snapshot omits entryA; accepted identity ownership still retains that earlier entry.
- `03-absent-unknown.json`: unknown header amount and absent detail retain unknowns rather than treating them as zero.
- `04-removed.json`: explicit source removal, with no inferred refund or cash change.
- `05-negative-transfer.json`: canonical -25 with raw debit-positive25, an explicit transfer flag and child version.
- `06-unknown-entry.json`: known zero header with unknown entry amount and unrecognized raw status.

Imported and accepted observations remain manual, unverified, and unlinked to local claims. Source claim, line, and procedure IDs are opaque source references. These fixtures do not instruct a payment, allocate cash, verify a deposit, or establish settlement.
