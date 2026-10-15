# Existing denial-code reference review

Reviewed 2026-10-13 for FW-04. This checks the repository's existing 13 entries;
it does not add a complete code dictionary, establish licensing rights, or
validate a payer's use of a code for a particular claim.

## Primary sources and corrections

The [X12 CARC page](https://x12.org/codes/claim-adjustment-reason-codes) was checked
for every existing CARC/group combination: CO-50, CO-29, CO-96, CO-97, CO-109,
CO-167, PR-1, PR-2, PR-3, and PR-204. CO-50's annotation now specifies medical
necessity. Unsupported payer prevalence, filing windows, clinical scenarios,
and action instructions were removed from the comments. The repository
preserves the reported combined spelling without automatically assigning
separate authoritative group or reason fields.

The [X12 RARC page](https://x12.org/codes/remittance-advice-remark-codes) establishes
that N362 concerns excessive days/units, N370 concerns rental duration beyond the
payer's allowance, and N522 specifically concerns a crossover duplicate. The
missing-tooth interpretation of N370 and the claimed Delta frequency scenario
were removed. These are brief review notes, not reproduced dictionary entries.

## Implemented containment and remaining limitations

`SummaryOutputSchema` now preserves unfamiliar reported denial-code strings up to
64 characters, trimming surrounding whitespace without changing spelling or
assigning semantics. Blank strings become null; oversized and non-string values
remain malformed output. `isKnownDenialCode` identifies only the existing exact
recognition subset. Being outside that subset is not proof of hallucination.
The summary-worker must route unfamiliar codes to review independently of model
confidence or a proposed next action. Both existing adapter boundaries are tested
with synthetic responses; no live model was invoked for this change.

Historical `prompts/v1.ts` remains unchanged. It still instructs its model to omit
unfamiliar codes; accepting a returned unfamiliar code cannot recover one the
model already omitted. Replacing that instruction belongs to the Fireworks
gateway/prompt release and evaluation work. No new Claude prompt release was made.

The flat `denialCode` column still lacks separate code system, adjustment group,
reference version, source evidence, and adjudicated interpretation. A bounded raw
string and a recognition test do not establish source fidelity or the correctness
of adjacent model-written explanations. Those contracts, licensed references,
and domain-adjudicated evaluations remain required for production use.
