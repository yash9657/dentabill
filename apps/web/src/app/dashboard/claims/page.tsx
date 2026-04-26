import type { Metadata } from 'next';
import * as React from 'react';

import { DashboardEmptyState, SkeletonTable } from '../../../components/dashboard/index.js';

export const metadata: Metadata = { title: 'Claims' };

export default function DashboardClaimsPage(): React.ReactElement {
  return (
    <DashboardEmptyState
      eyebrow="Claims"
      title="Bring in your open claims"
      body="Once you upload a CSV from Dentrix, Eaglesoft, or Open Dental, every open claim shows up here ranked by aging, amount, and payer. The import flow ships in P2-T51; the live list and filters ship in P2-T41."
      previewChildren={<SkeletonTable rows={6} columns={5} />}
      primaryCta={{ label: 'Import claims', href: '/dashboard/claims/import' }}
      secondaryCta={{ label: 'View documentation', href: '/security' }}
    />
  );
}
