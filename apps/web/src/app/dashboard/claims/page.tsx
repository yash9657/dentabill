import type { Metadata } from 'next';
import * as React from 'react';

import { DashboardPageStub } from '../../../components/dashboard/index.js';

export const metadata: Metadata = { title: 'Claims' };

export default function DashboardClaimsPage(): React.ReactElement {
  return (
    <DashboardPageStub
      title="Claims"
      nextTaskId="P2-T36 (empty state) and P2-T41 (real list)"
      description="The claims list will live here once the API ships. From this view you will be able to filter by payer, status, and service date, and click through to a single claim's call history."
    />
  );
}
