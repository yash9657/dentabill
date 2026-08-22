import type { Metadata } from 'next';
import * as React from 'react';

import { OverviewEmptySection, OverviewStatStrip } from '../../../components/dashboard/index.js';
import type { OverviewStat } from '../../../components/dashboard/index.js';
import { MissingNpiBanner } from '../../../components/dashboard/missing-npi-banner.js';
import { OverviewKpiTiles } from '../../../components/dashboard/overview-kpi-tiles.js';

/**
 * `/dashboard/overview` — the post-sign-in landing page.
 *
 * Three blocks, in reading order:
 *
 *   1. Stat strip. Calls today, queue depth, denials this week,
 *      recovered amount. Em-dash placeholders on first load until
 *      data is available. The strip is one cohesive horizontal block,
 *      not a card grid — Impeccable design law against the
 *      four-cards-in-a-row template applies here.
 *   2. Recent claims panel. Empty state with a "Import claims" CTA
 *      pointing at the claims index until the import flow ships in
 *      P2-T51.
 *   3. Recent calls panel. Empty state explaining calls will appear here
 *      once the call worker starts, with a CTA back to the calls index.
 *
 * The two panels stack on phones and tablets and reflow into a
 * 2-up grid only above the lg breakpoint, so each panel keeps its
 * full readable width on the dashboard's sidebar-shrunken content
 * column.
 */
export const metadata: Metadata = {
  title: 'Overview',
};

/**
 * Static placeholder strip shown when Clerk auth is unmounted (e.g.
 * CI / preview without Clerk keys). The live `<OverviewKpiTiles>`
 * island fetches `/v1/calls/stats` once Clerk is wired in.
 */
const PLACEHOLDER_STATS: readonly OverviewStat[] = [
  { label: 'Calls today', value: '—', caption: 'Sign in to see live metrics' },
  { label: 'Queue depth', value: '—', caption: 'Pending follow-ups' },
  { label: 'Avg call (7d)', value: '—', caption: 'Last seven days' },
  { label: 'Recovered (7d)', value: '—', caption: 'Resolved claims, last seven days' },
];

function hasClerkKeys(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

export default function DashboardOverviewPage(): React.ReactElement {
  return (
    <div className="flex flex-col gap-8">
      <header className="max-w-3xl">
        <h1 className="font-display text-[28px] font-light leading-[1.15] tracking-[-0.01em] text-black sm:text-[32px]">
          Welcome back
        </h1>
        <p className="text-body text-gray-dark mt-2">
          A snapshot of what DentaBill is doing for your practice today. Numbers fill in the moment
          claims start moving through the queue.
        </p>
      </header>

      {hasClerkKeys() ? <MissingNpiBanner /> : null}

      {hasClerkKeys() ? <OverviewKpiTiles /> : <OverviewStatStrip stats={PLACEHOLDER_STATS} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <OverviewEmptySection
          eyebrow="Recent claims"
          heading="Nothing in the queue yet"
          body="Upload a CSV from Dentrix, Eaglesoft, or Open Dental and DentaBill will start prioritising follow-ups by aging, amount, and payer. The import flow ships in P2-T51."
          ctaLabel="Open claims"
          ctaHref="/dashboard/claims"
        />
        <OverviewEmptySection
          eyebrow="Recent calls"
          heading="No payer calls yet"
          body="Every payer call DentaBill makes will appear here in chronological order with the claim it touched and the result."
          ctaLabel="Open calls"
          ctaHref="/dashboard/calls"
        />
      </div>
    </div>
  );
}
