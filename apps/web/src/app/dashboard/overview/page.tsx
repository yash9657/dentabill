import type { Metadata } from 'next';
import * as React from 'react';

/**
 * `/dashboard/overview` — the post-sign-in landing page.
 *
 * P2-T32 lands the empty shell so the layout, breadcrumbs, and
 * mobile drawer can be reviewed visually and exercised by e2e.
 * The real overview content (KPI summary, recent claims preview,
 * recent calls list — all with empty-state CTAs) lands with
 * P2-T35.
 *
 * Keeping the placeholder copy spare on purpose: this page is the
 * first thing a freshly-onboarded biller sees, so when it ships
 * for real (T35) it should not have to compete with leftover
 * Phase-2-progress noise. Today it is a single sentence.
 */
export const metadata: Metadata = {
  title: 'Overview',
};

export default function DashboardOverviewPage(): React.ReactElement {
  return (
    <section aria-labelledby="overview-heading" className="max-w-3xl">
      <h1
        id="overview-heading"
        className="font-display mb-3 text-[28px] font-light leading-[1.15] tracking-[-0.01em] text-black sm:text-[32px]"
      >
        Overview
      </h1>
      <p className="text-body text-gray-dark">
        The dashboard shell is in place. Real content — call activity, queue depth, recent claims,
        and recovered amounts — arrives with P2-T35.
      </p>
    </section>
  );
}
