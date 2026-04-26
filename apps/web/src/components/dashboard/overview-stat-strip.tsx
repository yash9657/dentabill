import * as React from 'react';

/**
 * `<OverviewStatStrip>` — the four headline stats on /dashboard/overview.
 *
 * Deliberately NOT a card grid. Per Impeccable's design laws and
 * `DESIGN.md`, four bordered cards arranged 2x2 / 4-up is the
 * tired SaaS dashboard treatment we are rejecting. A single
 * horizontal strip with vertical hairlines between stats reads as
 * one cohesive block, lets the eye scan left-to-right without
 * fighting card chrome, and stays achromatic per ADR-013.
 *
 * Each stat carries:
 *   • `label` — short noun phrase, capitalised once. The eyebrow.
 *   • `value` — the headline number. Em-dash placeholder when empty
 *     so the layout does not jump when real numbers land in P2-T41
 *     (claims) and Phase 3 (calls).
 *   • `caption` — small contextual line under the value (delta,
 *     period, or cohort reference). Optional.
 *
 * Below `md` the row reflows to a 2x2 grid with the same dividers
 * so the strip stays compact on phones without wrapping into four
 * full-width rows.
 */
export interface OverviewStat {
  readonly label: string;
  readonly value: string;
  readonly caption?: string;
}

export interface OverviewStatStripProps {
  readonly stats: readonly OverviewStat[];
}

export function OverviewStatStrip({ stats }: OverviewStatStripProps): React.ReactElement {
  return (
    <section
      aria-label="Headline metrics"
      className="hairline-edge bg-stone-warm/30 grid grid-cols-2 gap-px overflow-hidden rounded-[20px] md:grid-cols-4"
    >
      {stats.map((stat) => (
        <div key={stat.label} className="bg-white px-5 py-5 sm:px-6 sm:py-6">
          <p className="text-caption text-gray-warm uppercase tracking-[0.14em]">{stat.label}</p>
          <p className="font-display mt-2 text-[28px] font-extralight leading-[1.1] tracking-[-0.01em] text-black sm:text-[32px]">
            {stat.value}
          </p>
          {stat.caption ? <p className="text-caption text-gray-warm mt-1">{stat.caption}</p> : null}
        </div>
      ))}
    </section>
  );
}
