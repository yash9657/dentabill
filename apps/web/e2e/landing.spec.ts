import { expect, test } from './fixtures.js';

/**
 * Landing-specific Playwright suite. The per-page render / a11y /
 * console-clean / OG-meta walk lives in `marketing.spec.ts`
 * (P2-T27); this file holds the things that only make sense on the
 * landing route:
 *
 *   - CSP + security headers asserted on the initial response.
 *   - Visual regression baseline.
 *   - The `/contact` form end-to-end submission (it's the only
 *     interactive path on the marketing site, so the assertion
 *     stays here rather than living in the parameterised loop).
 *   - The 404 path (root not-found.tsx) and the static
 *     `/robots.txt` + `/sitemap.xml`.
 */
test.describe('landing page (Phase 2 scaffold)', () => {
  test('initial response carries strict CSP + clickjacking + nosniff headers', async ({
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
    // the important property is that one of them is present and that
    // it has the per-request nonce.
    const csp =
      headers['content-security-policy'] ?? headers['content-security-policy-report-only'];
    expect(csp, 'CSP header present').toBeTruthy();
    expect(csp ?? '', 'CSP includes a script-src nonce').toMatch(/script-src[^;]*'nonce-/);

    expect(consoleErrors, 'no console errors during landing render').toEqual([]);
  });

  test('not-found page renders and stays a11y-clean', async ({ page, makeAxeBuilder }) => {
    const response = await page.goto('/this-route-does-not-exist');
    expect(response?.status(), '/no-route returns 404').toBe(404);
    await expect(page.getByText('404')).toBeVisible();
    const results = await makeAxeBuilder().analyze();
    expect(results.violations, 'axe violations on 404').toEqual([]);
  });

  test('/contact form submits and surfaces a 204 success state', async ({
    page,
    consoleErrors,
  }) => {
    await page.goto('/contact');
    await page.getByLabel(/your name/i).fill('Alex Garcia');
    await page.getByLabel(/work email/i).fill('alex@example.com');
    await page.getByLabel(/practice name/i).fill('Sunrise Family Dental');
    await page
      .getByLabel(/what is on your mind/i)
      .fill('We follow up on around eighty claims a week with Delta and Cigna and want a demo.');

    const apiResponse = page.waitForResponse(
      (r) => r.url().endsWith('/v1/contact') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /^send$/i }).click();
    const post = await apiResponse;
    expect(post.status(), 'POST /v1/contact returns 204').toBe(204);

    await expect(page.getByRole('status')).toContainText(/will be in touch/i);
    expect(consoleErrors).toEqual([]);
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
 * Visual regression. The screenshot baseline is committed alongside
 * the test under `__screenshots__/`. Authors update it intentionally
 * with `pnpm --filter @dentabill/web exec playwright test
 * --update-snapshots` and the diff goes through code review like any
 * other change.
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
