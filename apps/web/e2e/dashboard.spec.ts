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
    await expect(page.getByRole('heading', { level: 1, name: /welcome back/i })).toBeVisible();
    await expect(page.getByRole('region', { name: /headline metrics/i })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: /nothing in the queue yet/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: /no payer calls yet/i }),
    ).toBeVisible();

    const axeResults = await makeAxeBuilder().analyze();
    expect(axeResults.violations, 'axe violations on /dashboard/overview').toEqual([]);

    expect(consoleErrors).toEqual([]);
  });

  test('sidebar links navigate to each top-level dashboard route', async ({
    page,
    consoleErrors,
  }) => {
    await page.goto('/dashboard/overview');
    const sidebar = page.getByRole('navigation', { name: /^sidebar$/i });

    await sidebar.getByRole('link', { name: /claims/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/claims$/);
    await expect(page.getByRole('heading', { level: 1, name: /claims/i })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: /claims/i })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await sidebar.getByRole('link', { name: /reports/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/reports$/);
    await expect(sidebar.getByRole('link', { name: /reports/i })).toHaveAttribute(
      'aria-current',
      'page',
    );

    expect(consoleErrors).toEqual([]);
  });

  test('desktop collapse toggle persists the preference across reloads', async ({ page }) => {
    await page.goto('/dashboard/overview');
    const sidebar = page.getByRole('complementary', { name: /dashboard navigation/i });
    await expect(sidebar).toHaveAttribute('data-collapsed', 'false');

    await page.getByRole('button', { name: /collapse sidebar/i }).click();
    await expect(sidebar).toHaveAttribute('data-collapsed', 'true');

    await page.reload();
    const sidebarAfter = page.getByRole('complementary', { name: /dashboard navigation/i });
    await expect(sidebarAfter).toHaveAttribute('data-collapsed', 'true');
  });

  test('topbar exposes search, notifications, and account placeholders without Clerk keys', async ({
    page,
    consoleErrors,
  }) => {
    await page.goto('/dashboard/overview');

    const searchTriggers = page.getByRole('button', { name: /open command palette/i });
    await expect(searchTriggers.first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^notifications$/i })).toBeVisible();
    await expect(page.getByLabel(/demo workspace/i)).toBeVisible();
    await expect(page.getByLabel(/account placeholder/i)).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test('clicking the search trigger opens the command palette and Escape closes it', async ({
    page,
  }) => {
    await page.goto('/dashboard/overview');
    await page
      .getByRole('button', { name: /open command palette/i })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: /command palette/i });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
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
