import { request } from '@playwright/test';

/**
 * Pre-warms the routes Playwright tests will exercise so the first
 * real-test navigation does not pay `next dev`'s on-demand route-
 * compilation cost — that compile can run 5–30 s on the GitHub
 * Actions `ubuntu-latest` runner (which is slower than developer
 * laptops) and time out 5 s `toHaveURL` assertions even though the
 * application logic is healthy.
 *
 * One GET per route is enough: Next caches the compiled bundle for
 * the lifetime of the dev server, so all subsequent test workers hit
 * a hot route. Ignored response codes — protected routes returning a
 * redirect to /sign-in still trigger compilation, which is the goal.
 */
const ROUTES_TO_WARM = [
  '/',
  '/about',
  '/pricing',
  '/security',
  '/privacy',
  '/terms',
  '/contact',
  '/faq',
  '/blog',
  '/sign-in',
  '/sign-up',
  '/onboarding',
  '/dashboard',
  '/dashboard/overview',
  '/dashboard/claims',
  '/dashboard/claims/import',
  '/dashboard/calls',
  '/dashboard/reports',
  '/dashboard/settings',
  '/dashboard/settings/billing',
] as const;

export default async function globalSetup(): Promise<void> {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
  const ctx = await request.newContext({ baseURL });
  await Promise.all(
    ROUTES_TO_WARM.map((path) =>
      ctx.get(path, { failOnStatusCode: false, timeout: 60_000 }).catch(() => undefined),
    ),
  );
  await ctx.dispose();
}
