import type { Metadata } from 'next';
import * as React from 'react';

import { DashboardPageStub } from '../../../components/dashboard/index.js';

export const metadata: Metadata = { title: 'Reports' };

export default function DashboardReportsPage(): React.ReactElement {
  return (
    <DashboardPageStub
      title="Reports"
      nextTaskId="P2-T36 (empty state); analytics ship in Phase 4"
      description="Recovery reports, denial trends, and aging buckets will live here. Until the analytics pipeline is wired, the page renders an empty state."
    />
  );
}
