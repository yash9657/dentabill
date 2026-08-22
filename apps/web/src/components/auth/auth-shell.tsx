import Link from 'next/link';
import * as React from 'react';

import { Wordmark } from '../marketing/wordmark.js';

/**
 * Visual chrome shared by every `(auth)` page (`/sign-in`, `/sign-up`,
 * and any future `/forgot-password` flow).
 *
 * Distinct from `<MarketingLayout>` on purpose:
 *
 *   - No sticky header, no footer, no cookie banner. Auth flows want
 *     a single line of sight to the form. The marketing chrome's
 *     density would compete for the user's attention at exactly the
 *     moment they need to focus on a credential field.
 *   - Single column, vertically centred on tall viewports, top-aligned
 *     once the form grows past the fold so on-screen keyboards on
 *     mobile don't cover the inputs.
 *   - Wordmark is rendered as a quiet anchor back to the marketing
 *     site rather than the full nav. One escape hatch, one decision.
 *
 * Children compose the actual form (Clerk's `<SignIn>` /
 * `<SignUp>` when keys are set, the fallback card when they are
 * not). The shell only supplies typography defaults, the back-home
 * affordance, and the `<main>` landmark axe-core needs to accept
 * the page as having content structure.
 */
/**
 * `pageTitle` / `pageDescription` live outside `children` so the Clerk
 * slot can render its own step-specific header inside the card while
 * our page-level title still anchors the shell at the top.
 */
export interface AuthShellProps {
  readonly children: React.ReactNode;
  readonly pageTitle: string;
  readonly pageDescription: string;
}

export function AuthShell({
  children,
  pageTitle,
  pageDescription,
}: AuthShellProps): React.ReactElement {
  return (
    <main className="bg-warm-stone/40 flex min-h-screen flex-col items-center justify-start px-4 py-10 sm:py-16">
      <Link href="/" aria-label="DentaBill home" className="mb-10 rounded-sm">
        <Wordmark />
      </Link>

      <div className="w-full max-w-md text-center">
        <h1 className="font-display mb-3 text-balance text-[28px] font-light leading-[1.15] tracking-[-0.01em] text-black sm:text-[32px]">
          {pageTitle}
        </h1>
        <p className="text-body text-gray-dark mb-8 text-balance">{pageDescription}</p>
      </div>

      <div className="w-full max-w-md">{children}</div>

      <p className="text-caption text-gray-warm mt-12 max-w-sm text-center">
        By continuing you agree to our{' '}
        <Link href="/terms" className="underline-offset-2 hover:text-black hover:underline">
          Terms
        </Link>{' '}
        and{' '}
        <Link href="/privacy" className="underline-offset-2 hover:text-black hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
    </main>
  );
}
