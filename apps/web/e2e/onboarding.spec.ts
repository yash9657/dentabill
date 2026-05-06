import { expect, test } from './fixtures.js';

/**
 * Onboarding flow e2e (P2-T30).
 *
 * The route is reachable in CI without Clerk keys provisioned (the
 * middleware is a no-op there) so we exercise the form, the
 * same-origin /v1/onboarding round trip, and the post-submit
 * redirect to /dashboard/overview.
 */
test.describe('onboarding (P2-T30)', () => {
  test('renders the onboarding form, axe-clean, console-clean', async ({
    page,
    consoleErrors,
    makeAxeBuilder,
  }) => {
    const response = await page.goto('/onboarding');
    expect(response?.status(), '/onboarding returns 200').toBe(200);

    await expect(
      page.getByRole('heading', { level: 1, name: /set up your practice/i }),
    ).toBeVisible();
    await expect(page.getByLabel(/practice name/i)).toBeVisible();
    await expect(page.getByLabel(/zip code/i)).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /delta dental ppo/i })).toBeVisible();

    const axeResults = await makeAxeBuilder().analyze();
    expect(axeResults.violations).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('submits the form and redirects to /dashboard/overview', async ({ page }) => {
    await page.goto('/onboarding');

    await page.getByLabel(/practice name/i).fill('Sunrise Family Dental');
    await page.getByLabel(/zip code/i).fill('94110');
    await page.getByRole('checkbox', { name: /delta dental ppo/i }).check();
    await page.getByRole('checkbox', { name: /cigna dental/i }).check();
    // Both Delta and Cigna are Phase-3 dialable; the form now requires
    // a 10-digit NPI when any dialable payer is accepted.
    await page.getByLabel(/npi/i).fill('1234567890');

    const apiResponse = page.waitForResponse(
      (r) => r.url().endsWith('/v1/onboarding') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /continue to dashboard/i }).click();
    const post = await apiResponse;
    expect(post.status(), 'POST /v1/onboarding returns 204').toBe(204);

    await expect(page).toHaveURL(/\/dashboard\/overview$/);
  });

  test('rejects invalid input with inline error and does not POST', async ({ page }) => {
    await page.goto('/onboarding');

    await page.getByLabel(/practice name/i).fill('Sunrise Family Dental');
    await page.getByLabel(/zip code/i).fill('941');
    await page.getByRole('checkbox', { name: /metlife dental/i }).check();

    let posted = false;
    page.on('request', (r) => {
      if (r.url().endsWith('/v1/onboarding') && r.method() === 'POST') posted = true;
    });

    await page.getByRole('button', { name: /continue to dashboard/i }).click();
    await expect(page.getByText(/use a 5-digit us zip code/i)).toBeVisible();
    expect(posted).toBe(false);
  });
});
