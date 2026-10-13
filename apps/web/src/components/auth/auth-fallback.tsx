import { Pill } from '@dentabill/ui';
import * as React from 'react';

/**
 * Rendered in place of Clerk's `<SignIn>` / `<SignUp>` whenever
 * `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is unset — the dev / CI / preview
 * environments where we deliberately do not provision Clerk so the
 * marketing build stays self-contained.
 *
 * The fallback intentionally does NOT collect credentials. Any local
 * form would either be a dead form (UX lie) or a parallel auth path
 * we would have to maintain in lockstep with Clerk (security risk for
 * a Phase 2 feature). Instead it tells the visitor what is happening
 * and gives them the one useful action available: book a demo.
 *
 * Once Clerk keys are present (production, staging, any env with the
 * env vars set), the shell renders Clerk's component instead of this
 * one — the page itself is the gate.
 */
export interface AuthFallbackProps {
  readonly mode: 'sign-in' | 'sign-up';
}

export function AuthFallback({ mode }: AuthFallbackProps): React.ReactElement {
  const headline =
    mode === 'sign-in' ? 'Account access is in private beta.' : 'Account creation is on invite.';

  return (
    <section
      aria-label={mode === 'sign-in' ? 'Sign in availability' : 'Sign up availability'}
      className="hairline-edge shadow-card rounded-card-large bg-white px-6 py-10 sm:px-8"
    >
      <h2 className="font-display mb-3 text-xl font-medium text-black">{headline}</h2>
      <p className="text-body text-gray-dark mb-7">
        DentaBill is rolling out to a small group of dental practices first so we can keep call
        quality where it needs to be. Tell us about your practice and we will turn on access as soon
        as we have capacity in your region.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Pill href="/contact" variant="black" size="sm" withArrow>
          Request access
        </Pill>
        <Pill href="/" variant="whiteShadow" size="sm">
          Back to home
        </Pill>
      </div>
    </section>
  );
}
