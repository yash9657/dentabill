import { SignUp } from '@clerk/nextjs';
import type { Metadata } from 'next';
import * as React from 'react';

import { AuthFallback } from '../../../../components/auth/index.js';

/**
 * `/sign-up` — Clerk's hosted-component sign-up flow.
 *
 * Same conditional-render pattern as `/sign-in`: `<SignUp>` only
 * mounts when keys are set; otherwise the `<AuthFallback>` keeps
 * the route navigable. The catch-all segment `[[...sign-up]]` is
 * required so Clerk's sub-step routes (verify-email-address,
 * verify-phone-number) all resolve to this same page.
 *
 * Verify-email is **not** a separate page in our tree. Clerk's
 * sign-up flow renders the verification step inside the same
 * `<SignUp>` component when the URL is `/sign-up/verify-email-
 * address`; routing it through this catch-all keeps the layout
 * contiguous (same shell, same wordmark, same legal footer) and
 * avoids a hard navigation between steps.
 */
export const metadata: Metadata = {
  title: 'Sign up',
  description: 'Create a DentaBill account.',
  alternates: { canonical: '/sign-up' },
  robots: { index: false, follow: true },
};

const HAS_CLERK_KEYS = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default function SignUpPage(): React.ReactElement {
  if (!HAS_CLERK_KEYS) {
    return <AuthFallback mode="sign-up" />;
  }
  return (
    <SignUp
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
