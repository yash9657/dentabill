---
'name': 'DentaBill'
'description': 'A calm, clear workspace for dental insurance follow-up.'
'colors':
  'ink-inverse': '#edf4eb'
  'danger-soft': '#faeeeb'
  'danger': '#ad453d'
  'warning-soft': '#fbf0dc'
  'warning': '#93621c'
  'success-soft': '#e9f3ec'
  'success': '#29734f'
  'cream': '#faf8f1'
  'canvas': '#f6f7f3'
  'brand-soft': '#e5eee7'
  'brand-hover': '#183c32'
  'brand': '#214e40'
  'white': '#ffffff'
  'gray-light': '#f2f4f0'
  'gray-light-alt': '#f7f8f5'
  'warm-stone': '#f1eee6'
  'black': '#202e2b'
  'gray-dark': '#4f605a'
  'gray-warm': '#617068'
  'border-light': '#d7ded6'
  'border-subtle': '#e7ebe4'
  'status-active': '#397666'
  'ring-blue': '#397666'
  'grid-cyan': '#dfece4'
'typography':
  'hero':
    'fontFamily': 'var(--font-newsreader), Georgia, serif'
    'fontSize': 'clamp(2.75rem, 5.4vw, 4.75rem)'
    'fontWeight': 400
    'lineHeight': '1.08'
    'letterSpacing': '-0.96px'
  'section-heading':
    'fontFamily': 'var(--font-newsreader), Georgia, serif'
    'fontSize': 'clamp(2rem, 3.6vw, 3.25rem)'
    'fontWeight': 500
    'lineHeight': '1.17'
    'letterSpacing': '0'
  'card-heading':
    'fontFamily': 'var(--font-inter), Inter, system-ui, sans-serif'
    'fontSize': '26px'
    'fontWeight': 500
    'lineHeight': '1.13'
    'letterSpacing': '0'
  'body-large':
    'fontFamily': 'var(--font-inter), Inter, system-ui, sans-serif'
    'fontSize': '20px'
    'fontWeight': 400
    'lineHeight': '1.35'
    'letterSpacing': '0'
  'body':
    'fontFamily': 'var(--font-inter), Inter, system-ui, sans-serif'
    'fontSize': '18px'
    'fontWeight': 400
    'lineHeight': '1.65'
    'letterSpacing': '0'
  'body-standard':
    'fontFamily': 'var(--font-inter), Inter, system-ui, sans-serif'
    'fontSize': '16px'
    'fontWeight': 400
    'lineHeight': '1.5'
    'letterSpacing': '0'
  'nav-ui':
    'fontFamily': 'var(--font-inter), Inter, system-ui, sans-serif'
    'fontSize': '15px'
    'fontWeight': 500
    'lineHeight': '1.4'
    'letterSpacing': '0.15px'
  'button':
    'fontFamily': 'var(--font-inter), Inter, system-ui, sans-serif'
    'fontSize': '15px'
    'fontWeight': 500
    'lineHeight': '1.47'
    'letterSpacing': '0'
  'button-uppercase':
    'fontFamily': 'var(--font-inter), Inter, system-ui, sans-serif'
    'fontSize': '14px'
    'fontWeight': 700
    'lineHeight': '1.1'
    'letterSpacing': '0.7px'
  'caption':
    'fontFamily': 'var(--font-inter), Inter, system-ui, sans-serif'
    'fontSize': '14px'
    'fontWeight': 400
    'lineHeight': '1.5'
    'letterSpacing': '0.14px'
  'small':
    'fontFamily': 'var(--font-inter), Inter, system-ui, sans-serif'
    'fontSize': '13px'
    'fontWeight': 400
    'lineHeight': '1.38'
    'letterSpacing': '0'
  'code':
    'fontFamily': 'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    'fontSize': '13px'
    'fontWeight': 400
    'lineHeight': '1.85'
    'letterSpacing': '0'
  'micro':
    'fontFamily': 'var(--font-inter), Inter, system-ui, sans-serif'
    'fontSize': '12px'
    'fontWeight': 400
    'lineHeight': '1.33'
    'letterSpacing': '0'
  'tiny':
    'fontFamily': 'var(--font-inter), Inter, system-ui, sans-serif'
    'fontSize': '10px'
    'fontWeight': 400
    'lineHeight': '1.6'
    'letterSpacing': '0'
  'landing-display':
    'fontFamily': 'var(--font-newsreader), Georgia, serif'
    'fontSize': 'clamp(48px, 5.5vw, 78px)'
    'fontWeight': 400
    'lineHeight': '1.04'
    'letterSpacing': '-0.035em'
  'workspace-heading':
    'fontFamily': 'var(--font-inter), Inter, system-ui, sans-serif'
    'fontSize': '28px'
    'fontWeight': 600
    'lineHeight': '1.14'
    'letterSpacing': '-0.01em'
  'card-title':
    'fontFamily': 'var(--font-inter), Inter, system-ui, sans-serif'
    'fontSize': '20px'
    'fontWeight': 500
    'lineHeight': '1.25'
'rounded':
  'minimal': '2px'
  'subtle': '4px'
  'standard': '8px'
  'comfortable': '10px'
  'md': '12px'
  'card': '16px'
  'card-large': '16px'
  'section': '16px'
  'warm-button': '8px'
  'pill': '9999px'
'spacing':
  'px': '1px'
  '0.5': '2px'
  '1': '4px'
  '1.5': '6px'
  '2': '8px'
  '2.5': '10px'
  '3': '12px'
  '3.5': '14px'
  '4': '16px'
  '5': '20px'
  '6': '24px'
  '7': '28px'
  '8': '32px'
  '9': '36px'
  '10': '40px'
  '12': '48px'
  '16': '64px'
  '20': '80px'
  '24': '96px'
'components':
  'button-primary':
    'backgroundColor': '{colors.brand}'
    'textColor': '{colors.white}'
    'typography': '{typography.button}'
    'rounded': '{rounded.standard}'
    'padding': '0 16px'
    'height': '44px'
  'button-primary-hover':
    'backgroundColor': '{colors.brand-hover}'
  'button-secondary':
    'backgroundColor': '{colors.white}'
    'textColor': '{colors.black}'
    'typography': '{typography.button}'
    'rounded': '{rounded.standard}'
    'padding': '0 16px'
    'height': '44px'
  'button-secondary-hover':
    'backgroundColor': '{colors.gray-light}'
  'button-soft':
    'backgroundColor': '{colors.brand-soft}'
    'textColor': '{colors.brand}'
    'typography': '{typography.button}'
    'rounded': '{rounded.standard}'
    'padding': '0 16px'
    'height': '44px'
  'button-ghost':
    'backgroundColor': 'transparent'
    'textColor': '{colors.black}'
    'typography': '{typography.button}'
    'rounded': '{rounded.standard}'
    'padding': '0 16px'
    'height': '44px'
  'input':
    'backgroundColor': '{colors.white}'
    'textColor': '{colors.black}'
    'typography': '{typography.body-standard}'
    'rounded': '{rounded.standard}'
    'padding': '0 12px'
    'height': '44px'
  'badge-success':
    'backgroundColor': '{colors.success-soft}'
    'textColor': '{colors.success}'
    'rounded': '{rounded.pill}'
    'padding': '4px 10px'
  'card':
    'backgroundColor': '{colors.white}'
    'rounded': '{rounded.card}'
  'nav-active':
    'backgroundColor': '{colors.brand-soft}'
    'textColor': '{colors.brand}'
    'rounded': '{rounded.md}'
    'padding': '8px 12px'
  'brand-mark':
    'textColor': '{colors.brand}'
    'size': '32px'
  'claim-demo':
    'backgroundColor': '{colors.white}'
    'rounded': '{rounded.card}'
---

# Design System: DentaBill

## Overview

**Creative North Star: "The Calm Front Desk"**

DentaBill combines warm ivory, deep pine, and muted sage with editorial Newsreader headlines and practical Inter controls. The public site is open and conversational; the working application is compact, structured, and easy to scan. Both use the same colors, shapes, controls, and dental-outline identity.

This document records the implemented redesign. The normative implementation is packages/ui/src/theme.css and its TypeScript mirror, packages/ui/src/tokens.ts; app-specific compositions live in apps/web/src/app/globals.css. The frontmatter records their values, while the sidecar extends them with stateful previews, shadows, motion, and responsive metadata. The descriptive north star names the built system; it is not a record of an approved image-generation concept.

**Key Characteristics:**

- Warm ivory marketing canvas and pale green working canvas.
- Deep pine actions, sage selection, and distinct semantic status colors.
- Newsreader for editorial display; Inter for operations; Geist Mono for identifiers and code.
- Compact controls, softly rounded panels, fine dividers, and restrained elevation.
- A hand-authored dental-outline mark and an illustrative claim walkthrough.

## Colors

Warm neutrals establish the page; pine and sage provide identity and interaction, with restrained semantic colors for state.

### Primary

- **Deep Pine** (`brand`) anchors primary buttons, active navigation, links, the brand mark, and dark marketing/authentication sections. `brand-hover` deepens it for primary hover and active states.
- **Soft Sage** (`brand-soft`) marks selected navigation, supportive actions, call stages, selection highlights, and the closing marketing section.
- **Light Ink** (`ink-inverse`) provides readable text on pine sections.

### Neutral

- **Ivory** (`cream`) is the marketing and authentication canvas. **Working Canvas** (`canvas`) sits behind the dashboard.
- **White** (`white`) is the input and panel surface. **Pale Sage Neutrals** (`gray-light`, `gray-light-alt`) support hover, sidebar, loading, and quiet regions; **Warm Stone** (`warm-stone`) is a muted supporting surface.
- **Deep Green Ink** (`black`) is primary text. `gray-dark` is secondary copy and `gray-warm` is tertiary copy, placeholders, and metadata.
- `border-light` separates controls and major panels; `border-subtle` separates rows and quieter sections.

### Semantic states and compatibility names

Success, warning, and danger each have a strong foreground and matching `*-soft` fill. Active calls use `status-active` for the dot and the brand/brand-soft pair for their badge. These are intentionally chromatic; the former single-accent rule is obsolete.

`ring-blue` is a historical name for the current green focus token, and equals `status-active`. `grid-cyan` now holds a pale green value and is a compatibility token, not a cyan design direction. `black` is green ink rather than pure black. Keep these identifiers stable for existing callers; document their role from the implemented value.

**The Status With Meaning Rule.** Pair status color with a readable label; reserve the pulsing dot for an active call.

## Typography

**Display Font:** Newsreader, with Georgia and serif fallbacks. The app loads normal and italic styles at weights 400 and 500.

**Body Font:** Inter, with system sans-serif fallbacks. The app loads weights 400, 500, 600, and 700. Body copy is 400, controls and emphasis usually 500, and shared workspace page headings and KPI values 600. Some page-specific working headings use 500.

**Label/Mono Font:** Geist Mono, with platform monospace fallbacks, loaded at 400 and 500. Use for identifiers, codes, and code samples rather than general navigation.

The pairing gives the public site an editorial voice while keeping high-frequency tasks compact and legible. Font files are provided by Next's font loader with swap behavior. The `--font-inter-display` alias remains for compatibility; it does not define the current display face. The old 200/300-weight Inter display description is obsolete.

### Hierarchy

The frontmatter includes the shared type scale as named in the implementation, plus the distinct landing display, workspace heading, and Card title roles. These are not a mathematical ratio.

- **Hero and section display:** Shared `hero` and `section-heading` tokens support reusable public headings. HeroDisplay uses weight 400; SectionDisplay explicitly uses weight 500, overriding the shared display-weight token of 400. The landing hero deliberately uses its own `landing-display` composition; below 768px it becomes `clamp(40px, 8vw, 60px)`, and at widths up to 390px it is 39px. Landing section headings use `clamp(36px, 4vw, 52px)`, line-height 1.1, and weight 400.
- **Workspace headings:** The shared heading starts at 28px and changes to 32px at `sm`. The dashboard stylesheet also provides a `clamp(26px, 3vw, 32px)` fallback; explicit component utilities take precedence. Do not substitute the large serif hero scale on operational pages.
- **Card titles:** The reusable Card title is 20px, weight 500, line-height 1.25. The older 26px `card-heading` scale entry remains available; it is not the Card title default.
- **Body:** Shared body roles span 16px, 18px, and 20px. Landing supporting text is 17px with line-height 1.7 and a 470px maximum width. Dashboard copy commonly uses explicit 13px or 14px sizes; the dashboard body rule supplies 14px/1.65 where utilities do not override it.
- **Labels:** Buttons use the 15px button role at weight 500, with a 13px small size. Captions are 14px; metadata uses 12px and 13px. Tiny text is reserved for auxiliary labels. The `button-uppercase` scale is retained compatibility vocabulary, not the default CTA style; current buttons use sentence case.

**The Two Voices Rule.** Use Newsreader for editorial display and Inter for working headings, fields, navigation, and controls.

## Layout

The shared spacing base is 0.25rem (4px); the named TypeScript steps, including the 1px and half-step values, are captured in frontmatter. Tailwind numeric spacing follows that base. The implementation also uses local values for composed layouts, so the scale is not a claim that every measurement is a multiple of four.

The landing page container is `min(100% - 5rem, 1200px)`, changing to `calc(100% - 40px)` below 768px. Its desktop hero uses a 1.07fr/1fr grid with a 72px gap; it stacks in reading order on phones. The marketing header uses its own 1280px maximum and 16px/24px/32px responsive horizontal padding. This difference is intentional in the shipped composition.

The dashboard content has a 1500px maximum width and 16px, 24px, then 32px horizontal padding across base, `sm`, and `lg`. The header is 76px tall. At `lg`, the sidebar is 240px wide, or 72px when collapsed; below `lg` it is an off-canvas drawer. The drawer traps focus, makes background content inert, closes on Escape, and restores focus to its opener. Forms are generally capped at 760px. Tables and grids can scroll horizontally within the working area.

### Responsive behavior

- **Base/mobile:** The application has a 320px minimum width. Shared buttons are normally 44px tall; small variants are 36px. Narrow dashboard rules maintain at least 36px on ordinary buttons. Inputs with explicit utility sizes retain those sizes; the dashboard's small-screen 16px field rule is a fallback, not a universal override.
- **`sm` (640px):** Shared working headings become 32px; the recovered-value trend SVG appears. Below this width, its data table remains while the plot is hidden. Denial reasons and per-payer recovery use responsive HTML bars with wrapping label/value rows at every width; payer call, resolved, and duration details remain visible.
- **`md` (768px):** Standard Tailwind tablet breakpoint; custom `max-width: 767px` rules stack landing/auth layouts and hide the authentication story column.
- **`lg` / `desktop` (1024px):** Desktop marketing navigation and dashboard sidebar appear; header actions and heading actions can lay out horizontally.
- **`xl` (1280px):** Reports and overview activity panels use two columns where specified.
- **Local composition thresholds:** 1100px reduces large marketing gaps and authentication padding; 390px tightens the hero and claim walkthrough. These are page composition rules, not new global scale steps.

## Elevation & Depth

Depth is a mix of pale surfaces, fine borders, and soft shadows. Ordinary workspace panels often use a 1px border; shared Card and neutral ShadowCard use the existing layered shadow. These are separate patterns, not a global no-border or no-shadow rule.

### Shadow Vocabulary

The sidecar records exact CSS values for all shared shadow tokens: `inset-border`, `inset-dark`, `outline-ring`, `soft-elevation`, `card`, `warm`, `edge`, `inset-ring`, and `card-layered`. The common Card stack combines an outline with two low-opacity lifts. Warm ShadowCard uses the warm shadow and a translucent warm-stone fill. The landing claim demo has its own green-tinted lift (`0 8px 48px -16px rgb(33 78 64 / 0.22)`).

Modal backdrops use a dark transparent scrim; the native-dialog base uses `rgb(20 40 31 / 0.35)`. Loading placeholders use a subdued gradient shimmer, and the empty-state preview uses a fade mask. These functional treatments do not establish decorative background gradients as a brand device.

**The Quiet Depth Rule.** Use borders and tonal surfaces for everyday structure; use the existing soft shadows for panels that need elevation.

## Shapes

Controls use the standard radius (8px); navigation uses `md` (12px); panels use `card` or `section` (16px). Small radii remain for minor detail. Pill geometry belongs to badges and status dots, not to the default button. The `card-large` and `section` radius names currently alias the same value as `card`, and `warm-button` matches `standard`.

The mark is hand-authored vector geometry: a simple tooth outline with rounded roots. It uses `currentColor` so it can adapt to pine or light contexts. The app icon puts the ivory mark inside a pine rounded square. `apps/web/public/apple-icon.png` is a 180×180 Sharp rasterization of `apps/web/src/app/icon.svg`; it is not generated imagery. Its provenance sidecar records the source.

## Components

### Buttons and action links

Compact and clear, with sentence-case labels. Primary is pine with white text; secondary is white with a 1px border; soft is sage with pine text; ghost is transparent. Standard and warm sizes are 44px tall with 16px horizontal padding, small is 36px with 12px padding, and large is 48px with 20px padding. The icon size is 44px tall and 40px wide.

Primary hover and active use the deeper pine. Secondary and ghost hover use the pale neutral; soft hover uses its sage fill at 70% opacity. Button and Pill focus outlines are 2px pine with a 2px offset; disabled controls use 50% opacity and suppress pointer interaction. Shared transitions use the standard 200ms duration and calm easing.

`Pill` is a compatibility API for action links: `black` maps to primary pine, `whiteShadow` to bordered secondary, and `warmStone` to soft sage. Its shape is the same 8px control radius, despite the old name. Button's `warmStone` variant likewise means soft sage.

### Inputs / Fields

White, bordered fields share the 8px radius and 44px height, with 12px horizontal padding. Input uses the 16px body-standard role, a muted placeholder, and a pine focus border. Native Select uses a 14px utility size. Invalid input adds the danger border and a 30%-opacity danger-soft fill; disabled fields use a not-allowed cursor and 50% opacity. Labels and descriptions remain visible beside validation errors.

The shared keyboard focus fallback is a 2px `ring-blue` outline with a 2px offset; that token is green. Input transitions use the fast 150ms duration and calm easing. Native select preserves platform keyboard and touch behavior.

### Chips / Status

Badge has a full pill radius, 4px vertical and 10px horizontal padding, a 6px gap, 13px text, and weight 500. Variants include neutral, success, warning, danger, outline, muted, and active. A badge communicates a state; it is not automatically a button.

StatusDot sizes are 6px, 8px, and 10px. Idle is pale, pending is a hollow muted ring, active is green and pulses, and success/warning/error use the semantic strong colors. Keep a nearby readable state label.

### Cards / Containers

Shared Card has a white surface, 16px radius, and layered shadow. Header padding is 24px; content and footer use 24px with no top padding. Its title is Inter at 20px and weight 500. ShadowCard uses the same 16px section radius with compact/default/roomy padding of 12px/16px/24px.

Dashboard overview panels are bordered white containers: 18px/24px header padding and 28px/24px body padding. Empty-state panels use 36px padding, reduced to 24px on phones. Avoid translating every grouping into a raised card when a row and divider already communicate the structure.

### Navigation

Marketing navigation uses 14px Inter at weight 500; current-page links become pine and underlined. Its mobile navigation replaces the desktop group below 1024px. Dashboard navigation uses 14px captions at weight 500, 18px icons, 12px gaps, and a minimum 44px row height. Active links use pine on sage and expose `aria-current="page"`; inactive hover uses warm-stone at 60% opacity and primary ink. The sidebar's small Workspace label groups navigation rather than introducing a page heading.

### Claim walkthrough and brand mark

The interactive marketing claim panel is the signature product illustration. A pine header, labeled illustrative claim, three selectable workflow stages, a serif result title, and a next-step button explain the flow. Completed stages use sage; the selected circular stage uses pine. Preserve its explicit sample-data label and ordered progression when reusing it. It is authored UI, not a screenshot or raster illustration.

### Focus and motion

All keyboard-interactive elements receive visible focus. Buttons/Pill use pine; the global fallback uses the green focus token. Motion tokens are fast (150ms), standard (200ms), slow (300ms), and `cubic-bezier(0.4, 0, 0.2, 1)`. The call dot pulses over 2s and skeleton shimmer runs over 1.5s. The sidebar transition is 200ms ease-out. Reduced-motion rules reduce animation/transition duration to 0.01ms, run one animation iteration, and disable smooth scrolling. Do not infer that every component uses every motion token.

## Do's and Don'ts

### Do:

- Do reuse the shared controls and token values before adding local styles.
- Do use pine for primary actions, sage for selection, and the semantic success, warning, and danger pairings for status.
- Do keep workspace headings and operational data in Inter, with tabular numerals for comparable values.
- Do preserve keyboard focus, meaningful labels, reduced-motion behavior, and narrow-screen reading order.
- Do label sample claim content as illustrative and use authored vectors for the brand.
- Do keep the recovered-value data table available when its trend plot is hidden on small screens, and preserve wrapping labels beside report bars.

### Don't:

- Don't carry the former ElevenLabs, achromatic-only, thin Inter display, or pill-button rules into new work.
- Don't use compatibility names such as ring-blue, grid-cyan, black, or warmStone to infer their current color or shape.
- Don't introduce decorative heading eyebrows, stock imagery, decorative gradients, invented testimonials, or fictional business metrics.
- Don't use color as the sole explanation of a claim or call state.
- Don't suppress the focus outline without a visible replacement or add bounce and elastic motion.
- Don't treat synthetic tonal ramps in the documentation panel as shipped application tokens.
