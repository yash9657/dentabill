import type { Metadata } from 'next';
import * as React from 'react';

import { DashboardEmptyState, SkeletonForm } from '../../../../components/dashboard/index.js';

export const metadata: Metadata = { title: 'Notifications · Settings' };

export default function SettingsNotificationsPage(): React.ReactElement {
  return (
    <DashboardEmptyState
      eyebrow="Notifications"
      title="Choose what to be alerted on"
      body="Per-event email and in-app notification preferences for call completions, denials, and high-priority follow-ups are coming soon."
      previewChildren={<SkeletonForm fields={4} />}
      primaryCta={{ label: 'Open overview', href: '/dashboard/overview' }}
    />
  );
}
