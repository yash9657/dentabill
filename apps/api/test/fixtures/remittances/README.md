# Synthetic remittance evidence

`partial-payment.json` is custom DentaBill version 1 claim-level evidence, not an X12 835 sample, a bank record, or a PMS posting. Every identifier and amount is fabricated. Unknown synthetic adjustment codes deliberately have no inferred accounting meaning.

The independently expected reconciliation is $100.00 reported, $80.00 allocated across two distinct source lines, and $20.00 unallocated. Adjustments of $12.00, −$3.00 and $0.00 are preserved separately and do not change that payment total. Cash receipt, posting and settlement remain unverified. Tests derive reversal and invalid-input variants from fresh copies.

For the visible import workflow, first import `../csv/opendental-source-details-synthetic.csv` with an explicit source namespace. Open its `source-detail-001` claim (`SYNTH-DETAIL-1`), then import `source-detail-001-payment.json`. It explicitly references `proc-line-01`, `proc-line-02`, and `coverage-secondary`; there is no matching by display number, procedure code, tooth, or subscriber fallback. Review the preview before accepting the payer-reported evidence.

Next import `source-detail-001-partial-reversal.json` on that same claim and review it. The payment reports $80.00 ($30.00/$40.00 on the two lines, $10.00 unallocated). The partial reversal reports −$20.00 (−$10.00/−$5.00 on those lines, −$5.00 unallocated), leaving $60.00 reported, $55.00 allocated, and $5.00 unallocated. This is a reversal of payer-reported evidence, not proof of recoupment, refund, cash settlement, or recovered revenue.
