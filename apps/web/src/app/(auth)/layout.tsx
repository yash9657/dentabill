import * as React from 'react';

import { AuthShell } from '../../components/auth/index.js';

/**
 * Layout for the auth surface (`/sign-in`, `/sign-up`, and any future
 * `/forgot-password` / `/verify-*` flow that lives outside Clerk's
 * own catch-all sub-routes).
 *
 * Lives in the `(auth)` route group so it does **not** inherit the
 * marketing chrome (sticky header, footer, cookie banner). Auth flows
 * want a single line of sight to the form: nothing else competing for
 * the cursor.
 *
 * The shell title / description is fixed at the layout level rather
 * than per page because both pages currently share the same anchor
 * copy ("Welcome back" feels wrong on /sign-up and "Create your
 * account" feels wrong on /sign-in, so we use a neutral framing that
 * works for both — Clerk's component supplies the step-specific
 * heading inside the card).
 */
export default function AuthLayout({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <AuthShell
      pageTitle="DentaBill"
      pageDescription="Sign in or create an account to manage your practice's claim follow-ups."
    >
      {children}
    </AuthShell>
  );
}
