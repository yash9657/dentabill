'use client';

import { SignUp } from '@clerk/nextjs';
import { Pill } from '@dentabill/ui';
import * as React from 'react';

/**
 * Client-side branch of the `/sign-up` route.
 *
 * Decides whether to mount Clerk's `<SignUp>` (invitation flow) or our
 * `<InviteOnlyPanel>` based on the URL. We read `window.location.search`
 * inside `useEffect` rather than via `useSearchParams()` because:
 *
 *   1. `useSearchParams` is empty during SSR / first paint when the
 *      page is rendered through a Suspense boundary, which produced a
 *      flash of the InviteOnlyPanel even when a ticket was present.
 *   2. Clerk's own `<SignUp>` component reads the ticket the same way
 *      (window.location). Aligning our detection eliminates the
 *      timing window where they could disagree.
 *
 * The first paint renders nothing (a blank card-shaped placeholder) so
 * we never paint the wrong component first. Once the effect runs we
 * flip into the correct branch.
 */
const TICKET_PARAMS = ['__clerk_ticket', '__clerk_invitation_token', 'ticket'] as const;

type Decision = 'pending' | 'invited' | 'no-invite';

function decide(): Decision {
  if (typeof window === 'undefined') return 'pending';
  const params = new URLSearchParams(window.location.search);
  const hasTicket = TICKET_PARAMS.some((key) => params.has(key) && params.get(key) !== '');
  return hasTicket ? 'invited' : 'no-invite';
}

export function SignUpClient(): React.ReactElement {
  const [decision, setDecision] = React.useState<Decision>('pending');

  React.useEffect(() => {
    setDecision(decide());
  }, []);

  if (decision === 'pending') {
    return <div className="min-h-[420px]" aria-hidden />;
  }

  if (decision === 'no-invite') {
    return <InviteOnlyPanel />;
  }

  return (
    <SignUp
      forceRedirectUrl="/onboarding"
      signInUrl="/sign-in"
      appearance={{
        elements: {
          rootBox: 'mx-auto w-full',
          cardBox: 'shadow-card hairline-edge rounded-card-large bg-white',
          card: 'shadow-none border-0 bg-transparent',
        },
      }}
    />
  );
}

function InviteOnlyPanel(): React.ReactElement {
  return (
    <div className="hairline-edge shadow-card rounded-card-large bg-white p-8 sm:p-10">
      <div className="space-y-3">
        <p className="text-caption text-gray-warm uppercase tracking-[0.14em]">
          By invitation only
        </p>
        <h1 className="font-display text-card-heading text-balance font-medium text-black">
          DentaBill onboarding is hand-walked.
        </h1>
        <p className="text-body text-gray-dark text-balance">
          We work with one practice at a time so the IVR maps and payer rules are right before your
          first real call. Tell us about your practice and we will send an invitation link within
          one business day.
        </p>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Pill href="/contact" variant="black" withArrow>
          Request access
        </Pill>
        <Pill href="/sign-in" variant="whiteShadow">
          I already have an account
        </Pill>
      </div>

      <p className="text-caption text-gray-warm mt-8">
        If you were invited, open the link from the invitation email — it carries the token that
        unlocks this form.
      </p>
    </div>
  );
}
