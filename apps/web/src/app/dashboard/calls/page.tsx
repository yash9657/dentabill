import type { Metadata } from 'next';
import * as React from 'react';

import { DashboardPageStub } from '../../../components/dashboard/index.js';

export const metadata: Metadata = { title: 'Calls' };

export default function DashboardCallsPage(): React.ReactElement {
  return (
    <DashboardPageStub
      title="Calls"
      nextTaskId="P2-T36 (empty state); live feed lands in Phase 3"
      description="Every payer call DentaBill makes will show up here, in chronological order, with the resulting claim status and a transcript link."
    />
  );
}
