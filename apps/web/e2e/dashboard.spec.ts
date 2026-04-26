import { expect, test } from './fixtures.js';

/**
 * Dashboard shell e2e (P2-T32).
 *
 * In CI/dev without Clerk keys, the middleware no-ops auth, so
 * `/dashboard/**` is publicly reachable and we can exercise the
 * shell directly without a fixture user.
 *
 * What we cover:
 *   - `/dashboard` redirects to `/dashboard/overview` (canonical
 *     post-sign-in landing per Clerk's afterSignInUrl env var).
 *   - The shell renders the sidebar landmark, the breadcrumb trail,
 *     and the page heading.
 *   - The hamburger toggle reveals the mobile drawer below `lg`
 *     and Escape closes it.
 *   - axe-core finds zero AA violations.
 *   - No console errors fire during the route lifecycle.
 *
 * The dashboard is not in `marketing.spec.ts`'s parameterised loop
 * because it has no OG meta (`robots: noindex,nofollow`) and is not
 * part of the public marketing surface.
 */
test.describe('dashboard shell (P2-T32)', () => {
  test('/dashboard redirects to /dashboard/overview and renders the shell', async ({
    page,
    consoleErrors,
    makeAxeBuilder,
  }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard\/overview$/);

    await expect(page.getByRole('complementary', { name: /dashboard navigation/i })).toBeAttached();
    await expect(page.getByRole('navigation', { name: /breadcrumb/i })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: /overview/i })).toBeVisible();

    const axeResults = await makeAxeBuilder().analyze();
    expect(axeResults.violations, 'axe violations on /dashboard/overview').toEqual([]);

    expect(consoleErrors).toEqual([]);
  });

  test('mobile hamburger opens the sidebar drawer and Escape closes it', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 844 });
    await page.goto('/dashboard/overview');

    const opener = page.getByRole('button', { name: /open menu/i });
    await expect(opener).toHaveAttribute('aria-expanded', 'false');
    await opener.click();
    await expect(opener).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('Escape');
    await expect(opener).toHaveAttribute('aria-expanded', 'false');
  });
});
