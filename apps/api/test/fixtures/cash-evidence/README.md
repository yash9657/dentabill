# Synthetic bank-account observations

These six copyable JSON files use the custom DentaBill version 1 cash-evidence contract. They are fabricated operator uploads, not bank exports, authenticated connector responses, EFT instructions, ERA/835 files, or PMS deposits. Importing or accepting them does not move funds or verify receipt/settlement.

Import and review each file before proceeding to the next if you want to see every state:

1. `01-pending-100.json`: one pending source transaction for $100.00. It contributes no posted amount.
2. `02-posted-90.json`: sequence 2 of that same transaction, now reported posted for $90.00. After acceptance, its contribution is $90.00, not $190.00.
3. `03-removed.json`: sequence 3 removes that source observation with null amounts. Importing it makes the prior accepted report stale; accepting it records removal. It does not manufacture a −$90.00 debit.
4. `04-independent-debit-20.json`: a separate posted debit, canonical amount −$20.00. The original source uses debit-positive signs, so `sourceAmount` is $20.00. No return/recoupment link is inferred.
5. `05-pending-p-75.json`: another source transaction, P, pending for $75.00; it contributes no posted amount.
6. `06-posted-q-75.json`: a new source transaction, Q, posted for $75.00 with an explicit pending-reference link to P. It contributes $75.00 once.

After all six are accepted, this source/account reports posted credit $75.00, debit magnitude $20.00, and net $55.00. The earlier $90.00 report remains in history but is removed from the current posted tally. These are source-report totals, not recovered revenue, verified bank settlement, or claim allocations.

`sourceSequence` describes explicit source ordering, not upload time or a lexically sorted version. Records are immutable: replay the exact file for an idempotent import; use a new record ID and higher sequence for a genuinely newer observation. Account, namespace, and transaction IDs are synthetic references, never credentials or bank account numbers. This slice intentionally makes no automatic claim, remittance, PLB, return, or PMS-posting match.
