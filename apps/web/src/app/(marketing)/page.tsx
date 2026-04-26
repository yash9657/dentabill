import { HeroDisplay, Pill, ShadowCard } from '@dentabill/ui';
import * as React from 'react';

/**
 * Phase 2 scaffold landing — a working preview of the design system end
 * to end (next/font → tokens → Tailwind v4 utilities → brand primitives).
 * The real marketing landing replaces this in P2-T18.
 *
 * Kept deliberately simple so it doubles as a smoke test: if next/font
 * isn't loaded, this page reads in the system fallback; if Tailwind isn't
 * piped through, the layout collapses; if `@dentabill/ui` is broken, the
 * imports fail at build time.
 *
 * The marketing layout (`(marketing)/layout.tsx`) provides the sticky
 * `<MarketingHeader>` + `<MarketingFooter>` + cookie notice; this page
 * only renders the centre hero block.
 */
export default function HomePage(): React.ReactElement {
  return (
    <main className="mx-auto flex max-w-3xl flex-col items-center justify-center gap-8 px-4 py-24 sm:py-32">
      <HeroDisplay className="text-center">Stop waiting on hold with insurance.</HeroDisplay>

      <p className="text-body-large text-gray-dark max-w-xl text-center">
        DentaBill calls payers, navigates IVRs, and returns structured claim status to your billing
        team — so your front desk gets time back.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Pill href="/sign-up" variant="black" withArrow>
          Start free trial
        </Pill>
        <Pill href="/contact" variant="whiteShadow">
          Book demo
        </Pill>
      </div>

      <ShadowCard className="mt-8 w-full" tone="warm" padding="roomy">
        <p className="text-caption text-gray-warm">
          Phase 2 scaffold — full marketing site lands across P2-T17 to T27.
        </p>
      </ShadowCard>
    </main>
  );
}
