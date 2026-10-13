import type { Metadata } from 'next';
import * as React from 'react';

import { DashboardEmptyState, SkeletonList } from '../../../../components/dashboard/index.js';

export const metadata: Metadata = { title: 'Team · Settings' };

export default function SettingsTeamPage(): React.ReactElement {
  return (
    <DashboardEmptyState
      eyebrow="Team"
      title="Invite the rest of your billing team"
      body="Manage your practice members from the organization menu in the top bar. A dedicated team management page is being prepared."
      previewChildren={<SkeletonList rows={4} />}
      primaryCta={{ label: 'Back to your workspace', href: '/dashboard/overview' }}
    />
  );
}
