import type { Metadata } from 'next';
import * as React from 'react';

import { AuthFallback } from '../../../../components/auth/index.js';

import { SignUpClient } from './sign-up-client.js';

/**
 * `/sign-up` — invite-only entry point.
 *
 * Self-serve sign-up is closed: prospects request access through
 * `/contact` and receive a Clerk invitation. The invitation email
 * lands the user back here with `?__clerk_ticket=…`, at which point
 * the Clerk `<SignUp>` component is mounted to finish the flow. The
 * URL inspection happens in `<SignUpClient>` (Client Component) via
 * `useSearchParams` so it reads the same source of truth Clerk's own
 * client uses.
 *
 * Without Clerk keys we render `<AuthFallback>` so local dev without
 * env vars stays navigable.
 */
export const metadata: Metadata = {
  title: 'Sign up',
  description: 'DentaBill is invite-only. Request access or finish your invitation here.',
  alternates: { canonical: '/sign-up' },
  robots: { index: false, follow: true },
};

const HAS_CLERK_KEYS = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default function SignUpPage(): React.ReactElement {
  if (!HAS_CLERK_KEYS) {
    return <AuthFallback mode="sign-up" />;
  }
  return <SignUpClient />;
}
