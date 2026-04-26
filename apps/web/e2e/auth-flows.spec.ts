import { expect, test } from './fixtures.js';

/**
 * Auth-flow navigation e2e (P2-T31).
 *
 * The full auth-flow plan in P2-T31 calls out four scenarios:
 *
 *   1. Unauthenticated /dashboard redirects to /sign-in.
 *   2. Sign-up creates Clerk user + DentaBill Organization + User.
 *   3. Org switcher works.
 *   4. Sign-out works.
 *
 * (2)–(4) require provisioned Clerk keys plus a fixture user, which
 * we deliberately keep out of CI so the marketing build stays self-
 * contained. They are tested against staging in pre-release manual
 * verification per ADR-024 (auth model). What CI can verify is the
 * navigation surface around those flows: that the routes link to
 * each other in the expected order, that the marketing CTAs point
 * at /sign-up and /sign-in, and that the post-onboarding redirect
 * target matches NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL.
 *
 * Scenario (1) — /dashboard redirect — is partially verifiable:
 * with no Clerk keys the middleware is a no-op so the dashboard
 * renders directly. We assert the *target* of the redirect-when-
 * authed path (/dashboard/overview) and document the gated path
 * for the staging suite.
 *
 * Together with `auth.spec.ts` (renders + a11y), `onboarding.spec.ts`
 * (form submission + redirect), and `dashboard.spec.ts` (shell +
 * sidebar nav), these four files cover the full Phase 2 auth-flow
 * surface area testable from CI.
 */
test.describe('auth flow navigation (P2-T31)', () => {
  test('marketing header CTAs route to /sign-in and /sign-up', async ({ page }) => {
    await page.goto('/');

    const header = page.getByRole('banner');
    await expect(header.getByRole('link', { name: /^sign in$/i })).toHaveAttribute(
      'href',
      '/sign-in',
    );
    await expect(header.getByRole('link', { name: /start free trial/i }).first()).toHaveAttribute(
      'href',
      '/sign-up',
    );

    await header.getByRole('link', { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole('heading', { level: 1, name: /dentabill/i })).toBeVisible();
  });

  test('sign-up to onboarding to dashboard navigation chain resolves', async ({
    page,
    consoleErrors,
  }) => {
    await page.goto('/sign-up');
    await expect(page.getByRole('heading', { level: 2, name: /on invite/i })).toBeVisible();

    await page.goto('/onboarding');
    await expect(
      page.getByRole('heading', { level: 1, name: /set up your practice/i }),
    ).toBeVisible();

    await page.getByLabel(/practice name/i).fill('Sunrise Family Dental');
    await page.getByLabel(/zip code/i).fill('94110');
    await page.getByRole('checkbox', { name: /delta dental ppo/i }).check();
    await page.getByRole('button', { name: /continue to dashboard/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/overview$/);

    expect(consoleErrors).toEqual([]);
  });

  test('onboarding "Skip for now" routes directly to /dashboard/overview', async ({ page }) => {
    await page.goto('/onboarding');
    await page.getByRole('link', { name: /skip for now/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/overview$/);
  });

  test('/dashboard/* breadcrumb trail matches the navigated route', async ({ page }) => {
    await page.goto('/dashboard/settings/billing');
    const breadcrumb = page.getByRole('navigation', { name: /breadcrumb/i });
    await expect(breadcrumb.getByRole('link', { name: /^dashboard$/i })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    await expect(breadcrumb.getByRole('link', { name: /^settings$/i })).toHaveAttribute(
      'href',
      '/dashboard/settings',
    );
    await expect(breadcrumb.getByText(/^billing$/i)).toHaveAttribute('aria-current', 'page');
  });

  test('robots.txt disallows /dashboard, /sign-in, /sign-up, /onboarding', async ({ page }) => {
    const response = await page.request.get('/robots.txt');
    expect(response.status()).toBe(200);
    const body = await response.text();
    for (const path of ['/dashboard/', '/sign-in', '/sign-up', '/onboarding']) {
      expect(body, `${path} disallowed`).toContain(`Disallow: ${path}`);
    }
  });
});

test.describe('auth-gated paths under no Clerk keys (P2-T31)', () => {
  /**
   * In CI without keys the middleware is a no-op, so /dashboard
   * resolves directly to /dashboard/overview. The staging suite
   * (out of scope for the apps/web e2e) covers the redirect-to-
   * /sign-in path with a real Clerk session.
   */
  test('/dashboard resolves to /dashboard/overview when middleware is a no-op', async ({
    page,
  }) => {
    const response = await page.goto('/dashboard');
    expect(response?.status(), '/dashboard returns 200').toBe(200);
    await expect(page).toHaveURL(/\/dashboard\/overview$/);
  });
});
