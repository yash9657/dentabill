import type { Metadata } from 'next';
import * as React from 'react';

import { DashboardEmptyState, SkeletonList } from '../../../components/dashboard/index.js';

export const metadata: Metadata = { title: 'Calls' };

export default function DashboardCallsPage(): React.ReactElement {
  return (
    <DashboardEmptyState
      eyebrow="Calls"
      title="Live payer calls land here"
      body="Every call DentaBill places to a payer will appear in this list, in chronological order, with the claim it touched and the resulting status. The call worker comes online in Phase 3."
      previewChildren={<SkeletonList rows={5} />}
      primaryCta={{ label: 'Open claims', href: '/dashboard/claims' }}
    />
  );
}
