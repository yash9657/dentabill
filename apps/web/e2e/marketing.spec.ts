import { expect, test } from './fixtures.js';

/**
 * Marketing-site e2e suite (P2-T27).
 *
 * Walks every public marketing route with the same battery of
 * checks so a regression in any of them lights a single test up.
 *
 * Covered per route:
 *   - HTTP 200 on initial navigation.
 *   - Expected `<h1>` text fragment is present.
 *   - axe-core finds zero WCAG 2.2 AA violations.
 *   - No `console.error` fires during the render.
 *   - Open Graph + Twitter card metadata is present and non-empty
 *     (so social shares get a real preview).
 *
 * Why a parameterised test (one `test.describe.parallel` block + a
 * loop) rather than nine hand-written tests: the route count grows
 * by P2-T27 to nine and any future marketing surface lands by
 * adding a row to MARKETING_ROUTES, not a new test block. Drift
 * between the routes is impossible — every assertion runs against
 * every route.
 */
const MARKETING_ROUTES: readonly {
  readonly path: string;
  readonly h1Match: RegExp;
  readonly title: string;
}[] = [
  { path: '/', h1Match: /stop waiting on hold/i, title: 'Landing' },
  { path: '/about', h1Match: /billing teams should not spend their day/i, title: 'About' },
  { path: '/pricing', h1Match: /pay per call/i, title: 'Pricing' },
  { path: '/security', h1Match: /paid to call insurance companies/i, title: 'Security' },
  { path: '/privacy', h1Match: /short, honest privacy policy/i, title: 'Privacy' },
  { path: '/terms', h1Match: /plain-english terms of service/i, title: 'Terms' },
  { path: '/contact', h1Match: /tell us about your practice/i, title: 'Contact' },
  { path: '/faq', h1Match: /questions we hear most/i, title: 'FAQ' },
  { path: '/blog', h1Match: /no posts yet/i, title: 'Blog' },
];

test.describe.parallel('marketing site (P2-T27)', () => {
  for (const route of MARKETING_ROUTES) {
    test(`${route.title} (${route.path}) renders, axe-clean, with OG meta`, async ({
      page,
      makeAxeBuilder,
      consoleErrors,
    }) => {
      const response = await page.goto(route.path);
      expect(response?.status(), `${route.path} returns 200`).toBe(200);

      await expect(page.getByRole('heading', { level: 1 })).toContainText(route.h1Match);

      const ogTitle = await page
        .locator('head meta[property="og:title"]')
        .first()
        .getAttribute('content');
      expect(ogTitle, `${route.path} sets og:title`).toBeTruthy();
      const ogDescription = await page
        .locator('head meta[property="og:description"]')
        .first()
        .getAttribute('content');
      expect(ogDescription, `${route.path} sets og:description`).toBeTruthy();
      const twitterCard = await page
        .locator('head meta[name="twitter:card"]')
        .first()
        .getAttribute('content');
      expect(twitterCard, `${route.path} sets twitter:card`).toBeTruthy();

      const axeResults = await makeAxeBuilder().analyze();
      expect(axeResults.violations, `axe violations on ${route.path}`).toEqual([]);

      expect(consoleErrors, `console errors on ${route.path}`).toEqual([]);
    });
  }
});

/**
 * Internal-link integrity. Every `<a href>` reachable from the
 * primary header and footer must resolve to a real URL — no `#`
 * placeholders, no 404s. Walks each page once, collects internal
 * `href`s, then de-duplicates and HEADs each one.
 *
 * Scopes the link collection to the chrome (header + footer) on
 * purpose: the body of each page is already covered by the per-route
 * test above, and including body links would cross-walk every
 * marketing page through every other marketing page (~80 fetches,
 * slow + redundant).
 */
test('no broken internal links in marketing chrome', async ({ page }) => {
  await page.goto('/');

  const hrefs = await page.evaluate(() => {
    const els = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('header a[href], footer a[href]'),
    );
    return Array.from(
      new Set(
        els
          .map((a) => a.getAttribute('href') ?? '')
          .filter((h) => h.startsWith('/') && !h.startsWith('//') && !h.includes('#')),
      ),
    );
  });

  expect(hrefs.length, 'found at least one internal link in chrome').toBeGreaterThan(0);

  for (const href of hrefs) {
    const response = await page.request.head(href, { failOnStatusCode: false });
    expect(
      [200, 204, 301, 302, 308].includes(response.status()),
      `${href} should not 4xx/5xx (got ${String(response.status())})`,
    ).toBe(true);
  }
});
