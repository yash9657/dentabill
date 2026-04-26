import { Pill } from '@dentabill/ui';
import * as React from 'react';

/**
 * `<OverviewEmptySection>` — section block with an empty-state body
 * and a single primary CTA.
 *
 * Used twice on /dashboard/overview ("Recent claims" and "Recent
 * calls"). Both panels share the same chrome so the eye reads them
 * as a pair without our having to maintain two near-identical
 * components. When real data arrives in P2-T41 (claims) and Phase 3
 * (calls), each panel swaps its body with a list — the headline,
 * eyebrow, and CTA stay in place.
 *
 * The empty body is a single sentence plus a CTA Pill, never a
 * giant illustration: ElevenLabs's dashboards do the same thing,
 * and oversized empty-state graphics quickly feel patronising once
 * the user has seen them on every load. One short sentence, one
 * primary action.
 *
 * Side-stripe / accent-bar treatments are explicitly avoided per
 * Impeccable's design laws — the panel chrome is a hairline edge
 * and the warm-stone shadow, nothing more.
 */
export interface OverviewEmptySectionProps {
  readonly eyebrow: string;
  readonly heading: string;
  readonly body: string;
  readonly ctaLabel: string;
  readonly ctaHref: string;
}

export function OverviewEmptySection({
  eyebrow,
  heading,
  body,
  ctaLabel,
  ctaHref,
}: OverviewEmptySectionProps): React.ReactElement {
  return (
    <section
      aria-labelledby={`${eyebrow.replace(/\s+/g, '-').toLowerCase()}-heading`}
      className="hairline-edge shadow-card rounded-[20px] bg-white p-6 sm:p-8"
    >
      <p className="text-caption text-gray-warm mb-3 uppercase tracking-[0.14em]">{eyebrow}</p>
      <h2
        id={`${eyebrow.replace(/\s+/g, '-').toLowerCase()}-heading`}
        className="font-display mb-3 text-[22px] font-light leading-[1.2] tracking-[-0.005em] text-black"
      >
        {heading}
      </h2>
      <p className="text-body text-gray-dark mb-6 max-w-prose">{body}</p>
      <Pill href={ctaHref} variant="black" size="sm" withArrow>
        {ctaLabel}
      </Pill>
    </section>
  );
}
