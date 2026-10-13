import { Pill } from '@dentabill/ui';
import * as React from 'react';

/**
 * `<MarketingPageStub>` — placeholder body for marketing routes
 * that the header / footer link to but whose real content lands in
 * a later task (P2-T20 onward). Lives so that:
 *
 *   - Footer + header links never 404 for a real user navigating
 *     in production. A "we're building this" page is far better UX
 *     than a generic 404, and prevents Next's prefetch console
 *     noise from fouling the e2e suite.
 *   - Each task that replaces the stub does so by overwriting the
 *     `page.tsx` of the relevant route, so the stub itself never
 *     fights for ownership of the file.
 *
 * Voice intentionally short: no countdown timer, no "coming soon
 * stay tuned" copy, no email-capture form — those are handled in
 * the proper page when it lands. This is plumbing, not a moment.
 */
export interface MarketingPageStubProps {
  readonly eyebrow: string;
  readonly heading: string;
  readonly body: string;
}

export function MarketingPageStub({
  eyebrow,
  heading,
  body,
}: MarketingPageStubProps): React.ReactElement {
  return (
    <main>
      <section className="mx-auto max-w-3xl px-4 pb-24 pt-24 sm:px-6 sm:pt-32 lg:px-8">
        <p className="text-caption text-gray-warm mb-4 uppercase tracking-[0.14em]">{eyebrow}</p>
        <h1 className="font-display mb-6 text-balance text-[40px] font-normal leading-[1.08] tracking-[-0.02em] text-black sm:text-[48px]">
          {heading}
        </h1>
        <p className="text-body-large text-gray-dark mb-10 max-w-2xl">{body}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Pill href="/" variant="black" withArrow>
            Back to home
          </Pill>
          <Pill href="/contact" variant="whiteShadow">
            Talk to us
          </Pill>
        </div>
      </section>
    </main>
  );
}
