'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { QueryProvider } from '@dentabill/ui/query';
import { tokens } from '@dentabill/ui/tokens';
import * as React from 'react';

/**
 * Single client-side provider tree mounted by the root RSC layout.
 *
 * Centralising providers here keeps `app/layout.tsx` an async Server
 * Component (so it can read request-scoped state like the request id)
 * while still letting us nest client-only contexts. Stack, outer to
 * inner:
 *
 *   1. `<ClerkProvider>` — auth boundary. Mounted only when
 *      `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is set. In dev/CI without
 *      keys, the provider is omitted entirely so Clerk does not log
 *      "missing publishable key" warnings to the console (which our
 *      Playwright `consoleErrors` fixture treats as a hard failure).
 *      The middleware uses the same `hasClerkKeys` gate, so
 *      authenticated routes (`/dashboard/**`) are also no-ops in dev
 *      without keys — marketing routes are unaffected either way.
 *      We theme Clerk's UI to match our design tokens (achromatic +
 *      warm, ADR-013): black primary, achromatic neutrals, warm
 *      stone hover, fully rounded pill buttons.
 *   2. `<QueryProvider>` — TanStack Query client (P2-T14).
 */
const CLERK_APPEARANCE = {
  variables: {
    colorPrimary: tokens.color.brand,
    colorText: tokens.color.black,
    colorTextSecondary: tokens.color.grayDark,
    colorBackground: 'oklch(1 0 0)',
    colorInputBackground: 'oklch(1 0 0)',
    colorInputText: tokens.color.black,
    colorNeutral: tokens.color.black,
    borderRadius: tokens.radius.standard,
    fontFamily: 'var(--font-inter), Inter, system-ui, sans-serif',
  },
  elements: {
    formButtonPrimary:
      'rounded-standard bg-brand text-white hover:bg-brand-hover font-body font-medium',
    card: 'shadow-card hairline-edge rounded-card-large',
    headerTitle: 'font-display font-medium text-black',
    socialButtonsBlockButton: 'rounded-standard border-border-light',
  },
} as const;

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export function Providers({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  if (!PUBLISHABLE_KEY) {
    return <QueryProvider>{children}</QueryProvider>;
  }
  return (
    <ClerkProvider appearance={CLERK_APPEARANCE} publishableKey={PUBLISHABLE_KEY}>
      <QueryProvider>{children}</QueryProvider>
    </ClerkProvider>
  );
}
