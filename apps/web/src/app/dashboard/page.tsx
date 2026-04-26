import { redirect } from 'next/navigation';

/**
 * `/dashboard` — canonical landing route. Always redirects to the
 * overview page; that's where Clerk's `afterSignInUrl` /
 * `afterSignUpUrl` env vars also point. Centralising the redirect
 * here keeps `/dashboard/overview` as the single navigation target
 * across the app — sidebar links, post-onboarding redirect, post-
 * sign-in redirect all converge on the same path.
 */
export default function DashboardIndex(): never {
  redirect('/dashboard/overview');
}
