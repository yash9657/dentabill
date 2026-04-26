import type { Metadata } from 'next';
import * as React from 'react';

import { DashboardEmptyState, SkeletonList } from '../../../../components/dashboard/index.js';

export const metadata: Metadata = { title: 'Team · Settings' };

export default function SettingsTeamPage(): React.ReactElement {
  return (
    <DashboardEmptyState
      eyebrow="Team"
      title="Invite the rest of your billing team"
      body="Member roles, invitations, and per-seat permissions are managed by Clerk's organization API. The full member list with role editing arrives alongside Phase 4 RBAC work."
      previewChildren={<SkeletonList rows={4} />}
      primaryCta={{ label: 'Open Clerk org switcher', href: '/dashboard/overview' }}
    />
  );
}
