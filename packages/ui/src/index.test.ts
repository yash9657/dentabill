import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { tokens } from './tokens.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const themeCssPath = path.join(__dirname, 'theme.css');
const themeCss = fs.readFileSync(themeCssPath, 'utf8');

/**
 * Indexes every `--token-name: value;` declaration in `theme.css` once at
 * module load. Returns `undefined` for missing tokens so a missing one shows
 * up as a clean assertion failure rather than a regex-construction error.
 *
 * Built with simple string ops instead of a dynamic RegExp so eslint's
 * `security/detect-non-literal-regexp` rule stays clean.
 */
const cssVars = new Map<string, string>();
{
  // Strip /* … */ comments first; otherwise a chunk like
  //   "/* shadow */\n  --shadow-inset-border: …"
  // is dropped because it doesn't start with `--` after trim.
  const stripped = themeCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const declarations = stripped.split(';');
  for (const raw of declarations) {
    const trimmed = raw.trim();
    const dashIdx = trimmed.indexOf('--');
    if (dashIdx === -1) continue;
    // A chunk may contain the opening `@theme {`; advance past it to the `--`.
    const fromDash = trimmed.slice(dashIdx);
    const colon = fromDash.indexOf(':');
    if (colon === -1) continue;
    const name = fromDash.slice(2, colon).trim();
    const value = fromDash.slice(colon + 1).trim();
    if (name) cssVars.set(name, value);
  }
}

function readCssVar(name: string): string | undefined {
  return cssVars.get(name);
}

/**
 * Helper: collapse whitespace differences (CSS allows runs of whitespace
 * inside `box-shadow` and similar values; the TS canon authors them
 * compactly). We compare normalized forms.
 */
function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

describe('@dentabill/ui — design tokens', () => {
  describe('color', () => {
    it.each([
      ['white', 'color-white'],
      ['grayLight', 'color-gray-light'],
      ['grayLightAlt', 'color-gray-light-alt'],
      ['warmStone', 'color-warm-stone'],
      ['black', 'color-black'],
      ['grayDark', 'color-gray-dark'],
      ['grayWarm', 'color-gray-warm'],
      ['borderLight', 'color-border-light'],
      ['borderSubtle', 'color-border-subtle'],
      ['statusActive', 'color-status-active'],
      ['ringBlue', 'color-ring-blue'],
      ['gridCyan', 'color-grid-cyan'],
    ])('color.%s matches CSS var --%s', (tsKey, cssName) => {
      const tsValue = tokens.color[tsKey as keyof typeof tokens.color];
      const cssValue = readCssVar(cssName);
      expect(cssValue, `--${cssName} missing from theme.css`).toBeDefined();
      expect(normalize(cssValue!)).toBe(normalize(tsValue));
    });

    it('locks the status accent to the exact OKLCH from ADR-013', () => {
      expect(tokens.color.statusActive).toBe('oklch(0.78 0.04 200)');
    });
  });

  describe('shadow', () => {
    it.each([
      ['insetBorder', 'shadow-inset-border'],
      ['insetDark', 'shadow-inset-dark'],
      ['outlineRing', 'shadow-outline-ring'],
      ['softElevation', 'shadow-soft-elevation'],
      ['card', 'shadow-card'],
      ['warm', 'shadow-warm'],
      ['edge', 'shadow-edge'],
      ['insetRing', 'shadow-inset-ring'],
      ['cardLayered', 'shadow-card-layered'],
    ])('shadow.%s matches CSS var --%s', (tsKey, cssName) => {
      const tsValue = tokens.shadow[tsKey as keyof typeof tokens.shadow];
      const cssValue = readCssVar(cssName);
      expect(cssValue, `--${cssName} missing from theme.css`).toBeDefined();
      // CSS authors the shadow values with extra spaces between rgba components;
      // normalize whitespace so the two forms compare equal.
      expect(normalize(cssValue!).replace(/\s*,\s*/g, ',')).toBe(
        normalize(tsValue).replace(/\s*,\s*/g, ','),
      );
    });

    it('warm shadow uses the warm color (rgba(78,50,23,...)) not neutral black', () => {
      expect(tokens.shadow.warm).toContain('78,50,23');
    });
  });

  describe('radius', () => {
    it.each([
      ['minimal', 'radius-minimal'],
      ['subtle', 'radius-subtle'],
      ['standard', 'radius-standard'],
      ['comfortable', 'radius-comfortable'],
      ['md', 'radius-md'],
      ['card', 'radius-card'],
      ['cardLarge', 'radius-card-large'],
      ['section', 'radius-section'],
      ['warmButton', 'radius-warm-button'],
      ['pill', 'radius-pill'],
    ])('radius.%s matches CSS var --%s', (tsKey, cssName) => {
      const tsValue = tokens.radius[tsKey as keyof typeof tokens.radius];
      expect(readCssVar(cssName)).toBe(tsValue);
    });

    it('pill radius is 9999px exactly', () => {
      expect(tokens.radius.pill).toBe('9999px');
    });
  });

  describe('typography', () => {
    it('display weights are locked to ADR-013 (200 hero, 300 sections)', () => {
      expect(tokens.typography.weight.displayHero).toBe('200');
      expect(tokens.typography.weight.display).toBe('300');
    });

    it('hero size matches ElevenLabs spec (48px / 1.08 / -0.96px)', () => {
      expect(tokens.typography.size.hero).toEqual({
        fontSize: '48px',
        lineHeight: '1.08',
        letterSpacing: '-0.96px',
      });
    });

    it('body uses positive letter-spacing (the airy reading quality)', () => {
      expect(tokens.typography.size.body.letterSpacing).toBe('0.18px');
      expect(tokens.typography.size.bodyStandard.letterSpacing).toBe('0.16px');
    });
  });

  describe('motion', () => {
    it('uses calm easing — no bounce/elastic per DESIGN.md', () => {
      expect(tokens.motion.ease).toBe('cubic-bezier(0.4, 0, 0.2, 1)');
    });

    it.each([
      ['durationFast', 'duration-fast'],
      ['durationStandard', 'duration-standard'],
      ['durationSlow', 'duration-slow'],
      ['ease', 'ease-calm'],
    ])('motion.%s matches CSS var --%s', (tsKey, cssName) => {
      const tsValue = tokens.motion[tsKey as keyof typeof tokens.motion];
      expect(readCssVar(cssName)).toBe(tsValue);
    });
  });

  describe('breakpoints', () => {
    it('single switch at 1024px per DESIGN.md §8', () => {
      expect(tokens.breakpoint.desktop).toBe('1024px');
    });
  });

  it('exposes a stable JSON snapshot for documentation', () => {
    // This snapshot is the de-facto JSON emit of the token table. Diffs in PRs
    // make every token change reviewable. Update with `vitest -u` when intentional.
    expect(tokens).toMatchSnapshot();
  });
});
