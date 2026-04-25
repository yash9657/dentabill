# UX Rules

## Component sourcing

- Always use `shadcn/ui`. Never hand-roll inputs, modals, dropdowns, tables, toasts.
- Install with `npx shadcn@latest add <name>`. Phase-1 set: button, card, badge, dialog, table, input, label, select, dropdown-menu, toast, skeleton, separator, avatar, sheet.

## Color tokens (Tailwind theme)

- Primary `#1B4F72` (navy), Secondary `#2E86AB`, Success `#27AE60`, Warning `#F39C12`, Error `#E74C3C`, Surface `#F8FAFC`, Card `#FFFFFF`, Border `#E2E8F0`, Text `#1A202C`, Muted `#718096`.
- Use semantic tokens via Tailwind, not raw hex in components.

## Typography

- Headings: Inter Bold. Body: Inter Regular 15px / line-height 1.6.
- Claim numbers, ref codes, NPI, codes: JetBrains Mono.
- Minimum font size anywhere: 13px.

## Layout

- Sidebar 240px navy, white text. Top bar 64px white + 1px gray bottom border. Content 24px padding, max-width 1280px centered.
- Breakpoints: <768 mobile (sidebar → bottom tabs), 768–1024 tablet (icons-only sidebar), >1024 desktop (full sidebar).

## Status badges

- PENDING gray · IN_QUEUE blue · CALLING blue+pulse · ON_HOLD yellow · HUMAN_REACHED green · COMPLETED green · DENIED red · FAILED red · MANUAL_REVIEW orange · RESOLVED green-muted.

## Motion

- Framer Motion only. Subtle (≤200ms). Respect `prefers-reduced-motion`.

## Accessibility (non-negotiable)

- WCAG 2.1 AA. Lighthouse a11y ≥ 95 on every public + dashboard page.
- All interactive elements keyboard-reachable; visible focus rings.
- Color is never the sole signal — pair with icon or label.
- Form fields have `<label>`s; errors announced via `aria-live`.
- Contrast ≥ 4.5:1 for body text, ≥ 3:1 for large/UI.

## Copy

- Plain English. No jargon for billing staff.
- Empty states: 1-line description + icon + clear next-action button.
- Error messages: what happened + what to do next. Never raw stack traces.

## Tables (claims page)

- 50 rows/page. Sticky header. Sortable Priority, Amount, Days Outstanding.
- Row actions in dropdown menu, not inline buttons.

## Live regions

- Active call updates use SSE; status changes announced via `aria-live="polite"`.
