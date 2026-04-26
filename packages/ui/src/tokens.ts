/**
 * DentaBill design tokens — single source of truth.
 *
 * Authored in OKLCH per ADR-015 (Tailwind v4 native), warm-tinted neutrals per
 * `DESIGN.md`. The hex equivalents documented in `DESIGN.md` are commented next
 * to each value for cross-reference; the OKLCH value is canonical.
 *
 * `theme.css` (in this same directory) mirrors these values as CSS custom
 * properties consumed by Tailwind v4's `@theme` directive. `tokens.test.ts`
 * parses `theme.css` and asserts it stays in sync — drift is a CI failure.
 *
 * To use a token in code:  `import { tokens } from '@dentabill/ui/tokens'`
 * To use a token in CSS:   `var(--color-warm-stone)` (after importing
 *                          `@dentabill/ui/theme.css`)
 */

export const tokens = {
  /** Color tokens in OKLCH; alpha expressed as `/ <alpha>`. */
  color: {
    // Surfaces
    /** Pure white — primary background, cards, button bg. */
    white: 'oklch(1 0 0)', // #ffffff
    /** Cool light gray — secondary surfaces. */
    grayLight: 'oklch(0.961 0 0)', // #f5f5f5
    /** Alternate light surface (slightly different from grayLight). */
    grayLightAlt: 'oklch(0.965 0 0)', // #f6f6f6
    /** The signature warm-stone. Use at ~80% opacity for translucent CTAs. */
    warmStone: 'oklch(0.957 0.005 75)', // #f5f2ef
    /** Pure black — primary text + dark buttons. */
    black: 'oklch(0 0 0)', // #000000

    // Text
    /** Secondary text, descriptions. */
    grayDark: 'oklch(0.428 0 0)', // #4e4e4e
    /** Tertiary text, muted links, decorative underlines (warm-tinted). */
    grayWarm: 'oklch(0.529 0.013 70)', // #777169

    // Borders
    /** Explicit borders (e.g. card outlines). */
    borderLight: 'oklch(0.911 0 0)', // #e5e5e5
    /** Ultra-subtle bottom borders (achieved via alpha). */
    borderSubtle: 'oklch(0 0 0 / 0.05)', // rgba(0,0,0,0.05)

    // Status accent — see ADR-013. Only for active call states.
    /** Muted teal — used ONLY for `CALLING` and live-call indicators. */
    statusActive: 'oklch(0.78 0.04 200)',

    // Focus
    /** Keyboard focus ring (Tailwind's `--tw-ring-color` analog). */
    ringBlue: 'oklch(0.81 0.085 240 / 0.5)', // rgb(147 197 253 / 0.5)

    // Decorative
    /** Decorative grid overlay (used at 25% per DESIGN.md `--g-bg`). */
    gridCyan: 'oklch(0.951 0.094 200)', // #7fffff
  },

  /** Multi-layer shadow stacks — see `DESIGN.md` §6 (Depth & elevation). */
  shadow: {
    /** Internal half-pixel inset edge — surfaces define themselves through felt-not-seen edges. */
    insetBorder: 'rgba(0,0,0,0.075) 0px 0px 0px 0.5px inset',
    /** Stronger inset variant. */
    insetDark: 'rgba(0,0,0,0.1) 0px 0px 0px 0.5px inset',
    /** Shadow-as-border ring (1px). */
    outlineRing: 'rgba(0,0,0,0.06) 0px 0px 0px 1px',
    /** Gentle elevation lift. */
    softElevation: 'rgba(0,0,0,0.04) 0px 4px 4px',
    /** Card / button elevation: hairline + soft. */
    card: 'rgba(0,0,0,0.4) 0px 0px 1px, rgba(0,0,0,0.04) 0px 4px 4px',
    /** Warm-tinted lift for the signature stone CTA. */
    warm: 'rgba(78,50,23,0.04) 0px 6px 16px',
    /** Subtle edge definition. */
    edge: 'rgba(0,0,0,0.08) 0px 0px 0px 0.5px',
    /** Strong inset border. */
    insetRing: 'rgba(0,0,0,0.1) 0px 0px 0px 1px inset',
    /** Three-layer "outline ring" stack from DESIGN.md depth Level 1. */
    cardLayered:
      'rgba(0,0,0,0.06) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 1px 2px, rgba(0,0,0,0.04) 0px 2px 4px',
  },

  /** Border radius scale — see `DESIGN.md` §5 (Border-radius scale). */
  radius: {
    /** Small links, inline elements. */
    minimal: '2px',
    /** Nav items, tab panels, tags. */
    subtle: '4px',
    /** Small containers. */
    standard: '8px',
    /** Medium cards, dropdowns. */
    comfortable: '10px',
    /** Medium containers. */
    md: '12px',
    /** Standard cards, articles. */
    card: '16px',
    /** Featured cards, code panels. */
    cardLarge: '20px',
    /** Large panels, section containers. */
    section: '24px',
    /** The signature warm stone CTA radius. */
    warmButton: '30px',
    /** Pill — primary buttons, navigation pills. */
    pill: '9999px',
  },

  /** 8px-base spacing scale — see `DESIGN.md` §5 (Spacing system). */
  spacing: {
    px: '1px',
    '0.5': '4px',
    '1': '8px',
    '1.5': '12px',
    '2': '16px',
    '2.5': '20px',
    '3': '24px',
    '3.5': '28px',
    '4': '32px',
    '5': '40px',
    '6': '48px',
    '7': '56px',
    '8': '64px',
    '9': '72px',
    '10': '80px',
    '12': '96px',
    '16': '128px',
    '20': '160px',
    '24': '192px',
  },

  /** Typography per `DESIGN.md` §3 hierarchy table. */
  typography: {
    family: {
      /** Display headings — Inter Display weights 200/300 per ADR-013. */
      display: 'var(--font-inter-display), Inter, system-ui, sans-serif',
      /** Body / UI — Inter weights 400/500. */
      body: 'var(--font-inter), Inter, system-ui, sans-serif',
      /** Code — Geist Mono. */
      mono: 'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    },
    /**
     * Numeric weights are documentation only — they are NOT emitted as
     * `--font-weight-*` CSS vars because `--font-weight-display: 300` would
     * generate a `font-display` utility that collides with the family token.
     * Use Tailwind's built-in weight utilities instead, per the mapping below.
     */
    weight: {
      /** Hero display — ethereal. Use `font-extralight` (Tailwind built-in). */
      displayHero: '200',
      /** Section + card headings. Use `font-light` (Tailwind built-in). */
      display: '300',
      /** Body. Use `font-normal` (Tailwind built-in). */
      body: '400',
      /** Emphasized body, UI text, nav, buttons. Use `font-medium` (Tailwind built-in). */
      bodyMedium: '500',
      /** Uppercase CTA labels only. Use `font-bold` (Tailwind built-in). */
      bold: '700',
    },
    size: {
      /** 48px display weight 200, line-height 1.08, tracking -0.96px. */
      hero: { fontSize: '48px', lineHeight: '1.08', letterSpacing: '-0.96px' },
      /** 36px display weight 300, line-height 1.17. */
      sectionHeading: { fontSize: '36px', lineHeight: '1.17', letterSpacing: '0' },
      /** 32px display weight 300, line-height 1.13. */
      cardHeading: { fontSize: '32px', lineHeight: '1.13', letterSpacing: '0' },
      /** 20px Inter 400, line-height 1.35. */
      bodyLarge: { fontSize: '20px', lineHeight: '1.35', letterSpacing: '0' },
      /** 18px Inter 400, line-height 1.5, tracking 0.18px (airy reading). */
      body: { fontSize: '18px', lineHeight: '1.5', letterSpacing: '0.18px' },
      /** 16px Inter 400, line-height 1.5, tracking 0.16px. */
      bodyStandard: { fontSize: '16px', lineHeight: '1.5', letterSpacing: '0.16px' },
      /** 15px Inter 500 — nav links + standard UI. */
      navUi: { fontSize: '15px', lineHeight: '1.4', letterSpacing: '0.15px' },
      /** 15px Inter 500 — button labels. */
      button: { fontSize: '15px', lineHeight: '1.47', letterSpacing: '0' },
      /** 14px display bold uppercase — CTA labels. */
      buttonUppercase: { fontSize: '14px', lineHeight: '1.10', letterSpacing: '0.7px' },
      /** 14px Inter — captions, metadata. */
      caption: { fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.14px' },
      /** 13px Inter 500 — tags, badges. */
      small: { fontSize: '13px', lineHeight: '1.38', letterSpacing: '0' },
      /** 13px Geist Mono, relaxed line-height — code blocks. */
      code: { fontSize: '13px', lineHeight: '1.85', letterSpacing: '0' },
      /** 12px Inter 500 — tiny labels. */
      micro: { fontSize: '12px', lineHeight: '1.33', letterSpacing: '0' },
      /** 10px Inter — fine print. */
      tiny: { fontSize: '10px', lineHeight: '1.6', letterSpacing: '0' },
    },
  },

  /** Motion. */
  motion: {
    /** 150ms — fast (instant feedback). */
    durationFast: '150ms',
    /** 200ms — standard (button hover). */
    durationStandard: '200ms',
    /** 300ms — slow (page transition). */
    durationSlow: '300ms',
    /** Calm, predictable easing. Avoid bounce/elastic. */
    ease: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },

  /** Breakpoints — single switch at 1024px per `DESIGN.md` §8. */
  breakpoint: {
    mobile: '0px',
    desktop: '1024px',
  },
} as const;

export type Tokens = typeof tokens;
