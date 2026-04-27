import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import * as React from 'react';

import { Wordmark } from '../../components/marketing/wordmark.js';
import { OnboardingForm } from '../../components/onboarding/onboarding-form.js';
import { getOnboardingStatus } from '../../lib/onboarding-status.js';

/**
 * `/onboarding` — first-login flow: collect the smallest set of
 * details that lets us stand up an Organization row and start
 * routing claims correctly. Practice name, optional NPI, zip,
 * accepted payers.
 *
 * Lives outside the `(marketing)` and `(auth)` route groups: this
 * page is reached by an authenticated user (post-sign-up) but
 * should not show the marketing chrome (would feel like marketing
 * is leaking into the product), and should not share the auth
 * shell either (the page is wider, with a step-1-of-1 indicator).
 *
 * `noindex` is set so the route never shows up in search; the same
 * Disallow line in `robots.ts` covers crawler discovery.
 */
export const metadata: Metadata = {
  title: 'Set up your practice',
  description: 'Tell DentaBill the basics about your practice so we can route calls correctly.',
  alternates: { canonical: '/onboarding' },
  robots: { index: false, follow: false },
};

export default async function OnboardingPage(): Promise<React.ReactElement> {
  // Already-onboarded users skip straight to the dashboard. We do this
  // server-side rather than in middleware because the DB is the only
  // source of truth — Clerk publicMetadata can lag the DB by tens of
  // seconds after a fresh onboarding submit.
  const status = await getOnboardingStatus();
  if (status.state === 'signed-out') redirect('/sign-in?redirect_url=/onboarding');
  if (status.state === 'onboarded') redirect('/dashboard/overview');

  return (
    <main className="bg-stone-warm/30 flex min-h-screen flex-col items-center px-4 py-10 sm:py-16">
      <Link
        href="/"
        aria-label="DentaBill home"
        className="mb-10 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
      >
        <Wordmark />
      </Link>

      <div className="hairline-edge shadow-card w-full max-w-2xl rounded-[20px] bg-white px-6 py-10 sm:px-10 sm:py-12">
        <p className="text-caption text-gray-warm mb-3 uppercase tracking-[0.14em]">
          One quick step
        </p>
        <h1 className="font-display mb-3 text-[28px] font-light leading-[1.15] tracking-[-0.01em] text-black sm:text-[32px]">
          Set up your practice
        </h1>
        <p className="text-body text-gray-dark mb-8 max-w-prose">
          DentaBill calls payers on behalf of your practice. The fields below tell us who you are,
          where you are, and which payers your billers chase claims with most. You can change all of
          these later from Settings.
        </p>

        <OnboardingForm />
      </div>

      <p className="text-caption text-gray-warm mt-12 max-w-sm text-center">
        Need help?{' '}
        <Link href="/contact" className="underline-offset-2 hover:text-black hover:underline">
          Talk to a human
        </Link>
        .
      </p>
    </main>
  );
}
