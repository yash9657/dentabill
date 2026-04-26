import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const presetCss = fs.readFileSync(path.join(__dirname, 'tailwind.preset.css'), 'utf8');

describe('@dentabill/ui — tailwind.preset.css', () => {
  it('imports the @theme tokens from theme.css', () => {
    // Quote style is up to prettier — check both.
    expect(presetCss).toMatch(/@import\s+['"]\.\/theme\.css['"]/);
  });

  it('declares the status-pulse keyframes (the only animation the design system uses by default)', () => {
    expect(presetCss).toMatch(/@keyframes\s+status-pulse\s*{/);
  });

  it('declares the achromatic shimmer keyframes for skeleton loading', () => {
    expect(presetCss).toMatch(/@keyframes\s+shimmer\s*{/);
  });

  it('exposes the hairline-edge utility (signature half-pixel inset edge)', () => {
    expect(presetCss).toMatch(/@utility\s+hairline-edge\s*{/);
    expect(presetCss).toMatch(/box-shadow:\s*var\(--shadow-inset-border\)/);
  });

  it('exposes the shadow-card-layered utility (DESIGN.md depth Level 1)', () => {
    expect(presetCss).toMatch(/@utility\s+shadow-card-layered\s*{/);
    expect(presetCss).toMatch(/var\(--shadow-card-layered\)/);
  });

  it('exposes the status-pulse utility tied to the calm easing token', () => {
    expect(presetCss).toMatch(/@utility\s+status-pulse\s*{/);
    expect(presetCss).toMatch(/var\(--ease-calm\)/);
  });

  it('exposes the shimmer utility using only achromatic grays (ADR-013)', () => {
    expect(presetCss).toMatch(/@utility\s+shimmer\s*{/);
    expect(presetCss).toMatch(/var\(--color-gray-light\)/);
    expect(presetCss).toMatch(/var\(--color-gray-light-alt\)/);
  });

  it('reduces motion when prefers-reduced-motion: reduce — WCAG 2.2 AA (ADR-021)', () => {
    expect(presetCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(presetCss).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
  });

  it('keeps a visible focus-visible ring (never outline: none — ADR-021)', () => {
    expect(presetCss).toMatch(/:focus-visible\b/);
    expect(presetCss).toMatch(/outline:\s*2px\s+solid\s+var\(--color-ring-blue\)/);
  });

  it('sets the body font + base color tokens at :where(html) so descendants inherit them', () => {
    expect(presetCss).toMatch(/:where\(html\)\s*{/);
    expect(presetCss).toMatch(/font-family:\s*var\(--font-body\)/);
    expect(presetCss).toMatch(/background-color:\s*var\(--color-white\)/);
  });
});
