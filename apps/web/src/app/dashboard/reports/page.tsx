import type { Metadata } from 'next';
import * as React from 'react';

import { DashboardEmptyState, SkeletonTable } from '../../../components/dashboard/index.js';

export const metadata: Metadata = { title: 'Reports' };

export default function DashboardReportsPage(): React.ReactElement {
  return (
    <DashboardEmptyState
      eyebrow="Reports"
      title="Recovery and aging analytics"
      body="Recovery totals, denial trends, aging buckets, and per-payer outcomes. The first analytics views ship in Phase 4 once we have meaningful call volume to summarise."
      previewChildren={<SkeletonTable rows={5} columns={4} />}
      primaryCta={{ label: 'Open overview', href: '/dashboard/overview' }}
    />
  );
}
