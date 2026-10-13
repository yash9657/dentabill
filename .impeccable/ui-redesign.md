# DentaBill interface redesign

Scope: all marketing, authentication, onboarding, dashboard, claim/call workflows, reports, settings, shared components, and brand assets. Requested by the user on 2026-10-12. Responsive behavior is a requirement; the hero must be memorable. This is a code-led implementation. No image-generation comp was approved. The Impeccable context and detector launchers were unavailable (permission denied); this brief records the actual built direction, not a claimed generated selection.

## Direction contract

THESIS: Dental teams should spend their day with patients, not chasing insurance. Lead with “Your front desk isn’t a call center.” and an interactive claim walkthrough that makes the product concrete.

OWN-WORLD: Warm ivory, deep pine, muted sage, Newsreader editorial headlines, and Inter for controls and work. A subtle dental outline gives the wordmark a clear connection to the practice. No stock imagery, decorative gradients, invented testimonials, or fictional business metrics.

STORY: Recognize the interruption, understand the CSV → payer call → answer sequence, and start free or request a demo. Example claims are explicitly illustrative.

FIRST VIEWPORT: Desktop pairs a large two-line editorial headline and two direct CTAs with an interactive claim status panel. Phone places the headline, actions, and panel in reading order. The compatibility row introduces the next section.

FORM: The marketing surface is Persuade, the dashboard is Operate, and legal/help copy is Read. Working screens use compact sans-serif headings, structured rows, labeled fields, visible statuses, and one primary action. The claim panel is the signature interaction; short state transitions respect reduced motion. No seed key exists because the launcher did not run.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Verification scope

Browser widths: 320, 390, 768, and 1440 pixels. Marketing, shared shell, onboarding, authentication fallbacks, and empty states are browser-inspected. Live organization data and hosted Clerk authentication are not available in the no-key local preview. Populated claims, calls, reports, imports, and settings retain their data hooks and receive component tests; do not describe those as authenticated end-to-end coverage.

## Brand provenance

All logo assets are authored vector geometry in the repository. `apps/web/public/apple-icon.png` is a 180-pixel rasterization of `apps/web/src/app/icon.svg` using Sharp, not generated imagery. Review screenshots are local verification output and gitignored.

## Finish record

Independent general reviewer subagent completed the finish review and two scoped verdict passes. Final disposition: ship for the three scored fixes (heading labels, report legibility, design documentation), not certification of every authenticated workflow. The unavailable custom reviewer/launcher was not represented as a successful tool run.

Production build, web/UI lint and typechecks, 313 web tests, 177 UI tests, formatting, and configured bundle budgets pass. Synthetic populated reports were additionally rendered from the actual component and production CSS and inspected at 390px and 1440px. Hosted Clerk flows, production organization data, and the cross-browser Playwright visual snapshot suite were not run; existing snapshot baselines need regeneration for this redesign. Changes are local and have not been deployed.

## Logo refinement

The user approved the interface and requested a revised logo, selecting “a subtle dental symbol with the wordmark.” Replaced the D/check with a single dental outline, rounded roots, and slightly looser wordmark spacing. Applied to all shared lockups and icon variants.
