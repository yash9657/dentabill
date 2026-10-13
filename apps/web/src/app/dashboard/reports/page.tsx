import type { Metadata } from 'next';
import * as React from 'react';

import { DashboardEmptyState, SkeletonTable } from '../../../components/dashboard/index.js';
import { ReportsPage } from '../../../components/dashboard/reports/reports-page.js';

export const metadata: Metadata = { title: 'Reports' };

export default function DashboardReportsPage(): React.ReactElement {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
    return (
      <DashboardEmptyState
        eyebrow="Reports"
        title="See the bigger picture"
        body="Sign in to review recovery trends, payer outcomes, and claim aging across your practice."
        previewChildren={<SkeletonTable rows={4} columns={3} />}
        primaryCta={{ label: 'Sign in', href: '/sign-in' }}
      />
    );
  return <ReportsPage />;
}
