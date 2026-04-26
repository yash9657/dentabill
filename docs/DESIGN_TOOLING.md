# Design tooling — Phase 2 onward

Two tools, composed. They handle different jobs and feed each other.

## The pair

| Tool                                                 | Type                  | Lives where                  | Run when                          |
| ---------------------------------------------------- | --------------------- | ---------------------------- | --------------------------------- |
| [Impeccable](https://github.com/pbakaus/impeccable)  | Claude Code **skill** | `.claude/skills/impeccable/` | Always loaded; invoke per session |
| [SkillUI](https://github.com/amaancoderx/npxskillui) | Standalone **CLI**    | `npx` invocation only        | Once per design-system reference  |

**Composition:** SkillUI extracts a `DESIGN.md` (colors, typography, spacing, animations, components) from a real reference site. Impeccable's `SKILL.md` requires a `PRODUCT.md` and looks for a `DESIGN.md` at repo root. SkillUI fills the `DESIGN.md` slot with concrete tokens; `$impeccable teach` interactively fills `PRODUCT.md`. From there every Impeccable command (`$impeccable craft`, `audit`, `critique`, `polish`, ...) produces output that's already on-brand.

## Why we don't make SkillUI a devDependency

SkillUI v1.3.2 was first published 2026-04-08 by `amaancoderx` — a young package with no broad track record. Bundling it as a permanent dev dep would put a freshly-published binary inside our supply chain. We'd rather invoke it on demand with the version pinned at the call site, so each invocation is an explicit deliberate choice.

Use **`npx skillui@1.3.2 …`** (not `npx skillui@latest`). When 1.4 ships and we want it, pin the new version explicitly in this doc and in the next ADR.

## When to run SkillUI

- **Phase 2 kickoff** — pick 1–3 reference sites whose visual language we admire (e.g. Linear, Stripe, Cron, Notion, the LunaBill site). Run SkillUI against each. Synthesize the pieces we like into a single curated DentaBill `DESIGN.md`.
- **Open enrollment / brand refresh** — re-extract whichever reference still feels right, replace the tokens, regenerate components.
- **Never run blind against arbitrary URLs.** It launches Playwright; we want to know what we're scraping.

## Recommended workflow

```bash
# 1. Run skillui in a SCRATCH directory outside the repo so its outputs don't
#    pollute your working tree. The output is ~50–200 MB with screenshots.
mkdir -p ~/scratch/dentabill-refs && cd ~/scratch/dentabill-refs

# 2. Pin the version explicitly. Default mode for static analysis only.
npx skillui@1.3.2 --url https://linear.app --name "Linear"

# 3. Ultra mode (Playwright + screenshots) only when you need it. One-time
#    Chromium install required.
npm install -g playwright && npx playwright install chromium
npx skillui@1.3.2 --url https://stripe.com --mode ultra --screens 7 --name "Stripe"

# 4. Open the output, harvest the parts you want, write them into the repo's
#    DESIGN.md by hand. DO NOT copy the entire output folder into the repo —
#    it's a scratch artifact, not a deliverable.
```

## Repo files SkillUI is meant to populate

| File          | How it gets populated                                                  | Committed? | Status                      |
| ------------- | ---------------------------------------------------------------------- | ---------- | --------------------------- |
| `PRODUCT.md`  | `$impeccable teach` (interactive)                                      | Yes        | Pending — Phase 2 kickoff   |
| `DESIGN.md`   | Curated synthesis (initially: ElevenLabs analysis; iterate from there) | Yes        | **Populated** — see ADR-012 |
| `references/` | Curated subset of SkillUI screens                                      | Optional   | Empty                       |

`PRODUCT.md` and `DESIGN.md` live at **repo root**, not under `docs/`, because that's where Impeccable's `load-context.mjs` script looks (case-insensitive).

## What NOT to commit

- `~/scratch/**` — keep all SkillUI raw output outside the repo.
- The `.skill` ZIP that SkillUI generates — we don't redistribute it.
- Full screenshot folders unless we're using a specific image as a long-term reference (then move that single image to `references/` with attribution in `DESIGN.md`).

## Permission to run SkillUI from inside this repo

Don't. Always run from a scratch directory. If you must run inside the repo, set `--out ./design-extracts/` and verify the path is in `.gitignore` first.
