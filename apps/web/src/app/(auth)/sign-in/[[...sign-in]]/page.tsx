import { SignIn } from '@clerk/nextjs';
import type { Metadata } from 'next';
import * as React from 'react';

import { AuthFallback } from '../../../../components/auth/index.js';

/**
 * `/sign-in` — Clerk's hosted-component sign-in flow rendered inside
 * the DentaBill auth shell.
 *
 * The catch-all segment `[[...sign-in]]` is required by Clerk so the
 * factor-second / verification / magic-link sub-routes
 * (`/sign-in/factor-one`, `/sign-in/verify`, etc.) all hit this page
 * — the component itself reads the URL and decides which step to
 * render. Without the catch-all those sub-routes 404.
 *
 * `<SignIn>` is rendered conditionally on the publishable key being
 * set: the same gate `apps/web/src/components/providers.tsx` uses
 * for `<ClerkProvider>`. In dev / CI the env var is unset, the
 * provider is not mounted, and rendering `<SignIn>` would throw a
 * "Clerk: useUser called outside ClerkProvider" hook error. The
 * `<AuthFallback>` lets us keep `/sign-in` in the navigable site
 * without breaking the marketing build.
 *
 * Page-level theming overrides what's already in `CLERK_APPEARANCE`
 * (providers.tsx) only for layout — the auth shell already provides
 * the centred container, so we strip Clerk's own outer card so it
 * does not double up.
 */
export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your DentaBill account.',
  alternates: { canonical: '/sign-in' },
  robots: { index: false, follow: true },
};

const HAS_CLERK_KEYS = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default function SignInPage(): React.ReactElement {
  if (!HAS_CLERK_KEYS) {
    return <AuthFallback mode="sign-in" />;
  }
  return (
    <SignIn
      appearance={{
        elements: {
          rootBox: 'mx-auto w-full',
          cardBox: 'shadow-card hairline-edge rounded-[20px] bg-white',
          card: 'shadow-none border-0 bg-transparent',
        },
      }}
    />
  );
}
