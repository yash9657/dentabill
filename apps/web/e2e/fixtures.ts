import AxeBuilder from '@axe-core/playwright';
import { test as base, type Page } from '@playwright/test';

/**
 * Shared Playwright fixtures for DentaBill e2e suites.
 *
 * Two additions on top of the stock Playwright `test`:
 *
 *   1. `makeAxeBuilder()` — a factory that returns an axe-core scanner
 *      pre-configured with WCAG 2.2 AA tags (per ADR-021). Using a factory
 *      rather than a pre-built instance lets each test scope the scan
 *      (e.g., `.include('main')`) without mutating shared state.
 *
 *   2. `consoleErrors` — an array that captures any `console.error()`
 *      output and any uncaught page errors that happen *during* the test.
 *      Listener is attached at fixture-build time so early errors aren't
 *      missed. Tests assert `expect(consoleErrors).toEqual([])` at the
 *      end. React's dev-mode warnings are tolerated; only error-level
 *      messages are captured.
 */

export type AxeBuilderFactory = () => AxeBuilder;

interface DentaBillFixtures {
  readonly makeAxeBuilder: AxeBuilderFactory;
  readonly consoleErrors: string[];
}

export const test = base.extend<DentaBillFixtures>({
  makeAxeBuilder: async ({ page }, use) => {
    const factory: AxeBuilderFactory = () =>
      new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
    await use(factory);
  },
  consoleErrors: async ({ page }: { page: Page }, use) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      errors.push(err.message);
    });
    await use(errors);
  },
});

export { expect } from '@playwright/test';
