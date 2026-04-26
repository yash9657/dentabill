import { expect, test } from './fixtures.js';

/**
 * Auth surface e2e (P2-T29).
 *
 * In CI / dev we deliberately do not provision Clerk keys, so both
 * `/sign-in` and `/sign-up` render the `<AuthFallback>` rather than
 * Clerk's hosted component. The assertions below cover what we
 * actually want to be true on the auth surface in either mode:
 *
 *   - The route is reachable (200 on initial GET).
 *   - The auth shell is present: wordmark linking back home, page
 *     title, legal footer with /terms + /privacy.
 *   - The body is axe-clean (WCAG 2.2 AA, ADR-021). Clerk's
 *     hosted components are themselves AA-clean per their docs;
 *     the part we own (shell + fallback) needs the explicit gate.
 *   - No console errors. ClerkProvider is gated on the
 *     publishable key being set, so its absence is silent in dev/
 *     CI — this assertion is what would have caught the unconditional-
 *     mount regression that broke marketing.spec.ts in the T28
 *     iteration.
 *
 * Auth pages have `robots: { index: false }` so the OG-meta loop
 * from `marketing.spec.ts` does not apply — there is no social
 * preview to assert.
 */
const AUTH_ROUTES: readonly { readonly path: string; readonly mode: 'sign-in' | 'sign-up' }[] = [
  { path: '/sign-in', mode: 'sign-in' },
  { path: '/sign-up', mode: 'sign-up' },
];

for (const route of AUTH_ROUTES) {
  test.describe(`auth surface: ${route.path}`, () => {
    test('renders the auth shell, axe-clean, console-clean', async ({
      page,
      makeAxeBuilder,
      consoleErrors,
    }) => {
      const response = await page.goto(route.path);
      expect(response?.status(), `${route.path} returns 200`).toBe(200);

      await expect(page.getByRole('link', { name: /dentabill home/i })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: /dentabill/i })).toBeVisible();
      await expect(page.getByRole('link', { name: /^terms$/i })).toHaveAttribute('href', '/terms');
      await expect(page.getByRole('link', { name: /privacy policy/i })).toHaveAttribute(
        'href',
        '/privacy',
      );

      const fallbackHeading = route.mode === 'sign-in' ? /private beta/i : /on invite/i;
      await expect(page.getByRole('heading', { level: 2, name: fallbackHeading })).toBeVisible();

      const axeResults = await makeAxeBuilder().analyze();
      expect(axeResults.violations, `axe violations on ${route.path}`).toEqual([]);

      expect(consoleErrors, `console errors on ${route.path}`).toEqual([]);
    });
  });
}

test('robots.txt continues to disallow /sign-in and /sign-up', async ({ page }) => {
  const robots = await page.request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  const body = await robots.text();
  expect(body).toMatch(/Disallow:\s*\/sign-in/);
  expect(body).toMatch(/Disallow:\s*\/sign-up/);
});
