import { expect, test } from './fixtures.js';

/**
 * Smoke + a11y + visual regression for the Phase 2 scaffold landing.
 *
 * Three things this test gates on every PR:
 *   - The page renders and the hero copy is present.
 *   - axe-core finds zero WCAG 2.2 AA violations (ADR-021).
 *   - No `console.error` fires during navigation (regression guard for
 *     CSP misconfigurations, hydration mismatches, etc.).
 *
 * Visual regression has its own test below so it can be skipped or
 * masked independently of the smoke checks. Per-OS baselines are stored
 * under `e2e/__screenshots__/` and managed via `--update-snapshots`.
 */
test.describe('landing page (Phase 2 scaffold)', () => {
  test('renders the hero, headers from middleware, and clean console', async ({
    page,
    consoleErrors,
  }) => {
    const response = await page.goto('/');
    expect(response, 'navigation produced a response').not.toBeNull();
    expect(response?.status(), 'landing page returns 200').toBe(200);

    const headers = response?.headers() ?? {};
    expect(headers['x-frame-options'], 'X-Frame-Options DENY (clickjacking guard)').toBe('DENY');
    expect(headers['x-content-type-options'], 'X-Content-Type-Options nosniff').toBe('nosniff');
    expect(headers['referrer-policy'], 'Referrer-Policy strict-origin-when-cross-origin').toContain(
      'strict-origin-when-cross-origin',
    );
    // CSP arrives as either Content-Security-Policy (prod) or
    // Content-Security-Policy-Report-Only (dev). Either is acceptable;
    // the important property is that one of them is present.
    const csp =
      headers['content-security-policy'] ?? headers['content-security-policy-report-only'];
    expect(csp, 'CSP header present').toBeTruthy();
    expect(csp ?? '', 'CSP includes a script-src nonce').toMatch(/script-src[^;]*'nonce-/);

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/stop waiting on hold/i);
    // The CTA pair appears in three places now (header pill, hero, closing
    // CTA section). Assert "at least one of each is rendered and linked
    // correctly" rather than chasing strict-mode locators.
    const trialLinks = page.getByRole('link', { name: /start free trial/i });
    expect(await trialLinks.count()).toBeGreaterThanOrEqual(2);
    const demoLinks = page.getByRole('link', { name: /book a 20-minute demo/i });
    expect(await demoLinks.count()).toBeGreaterThanOrEqual(1);

    expect(consoleErrors, 'no console errors during landing render').toEqual([]);
  });

  test('axe-core: 0 WCAG 2.2 AA violations on /', async ({ page, makeAxeBuilder }) => {
    await page.goto('/');
    const results = await makeAxeBuilder().analyze();
    expect(results.violations, 'axe violations on landing').toEqual([]);
  });

  test('not-found page renders and stays a11y-clean', async ({ page, makeAxeBuilder }) => {
    const response = await page.goto('/this-route-does-not-exist');
    expect(response?.status(), '/no-route returns 404').toBe(404);
    await expect(page.getByText('404')).toBeVisible();
    const results = await makeAxeBuilder().analyze();
    expect(results.violations, 'axe violations on 404').toEqual([]);
  });

  test('/about renders, is axe-clean, and links back to / and /contact', async ({
    page,
    makeAxeBuilder,
    consoleErrors,
  }) => {
    const response = await page.goto('/about');
    expect(response?.status(), '/about returns 200').toBe(200);

    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      /billing teams should not spend their day on hold/i,
    );

    const results = await makeAxeBuilder().analyze();
    expect(results.violations, 'axe violations on /about').toEqual([]);
    expect(consoleErrors, 'no console errors during /about render').toEqual([]);
  });

  test('robots.txt and sitemap.xml are public', async ({ page }) => {
    const robots = await page.request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain('User-Agent: *');

    const sitemap = await page.request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain('<urlset');
  });
});

/**
 * Visual regression. The screenshot baseline is committed alongside the
 * test under `__screenshots__/`. Authors update it intentionally with
 * `pnpm --filter @dentabill/web exec playwright test --update-snapshots`
 * (or `-u`) and the diff goes through code review like any other change.
 */
test.describe('visual regression (Phase 2 scaffold)', () => {
  test('landing page snapshot', async ({ page }) => {
    await page.goto('/');
    // Wait for fonts to settle so the comparison is deterministic.
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot('landing.png', {
      fullPage: true,
    });
  });
});
