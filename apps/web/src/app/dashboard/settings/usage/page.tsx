import type { Metadata } from 'next';
import * as React from 'react';

import { DashboardEmptyState, SkeletonTable } from '../../../../components/dashboard/index.js';
import { UsageSettingsPage } from '../../../../components/dashboard/settings/usage-settings-page.js';

export const metadata: Metadata = { title: 'Usage · Settings' };

export default function SettingsUsagePage(): React.ReactElement {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
    return (
      <DashboardEmptyState
        eyebrow="Settings"
        title="Your practice’s usage"
        body="Sign in to see call volume, minutes used, and your practice’s usage history."
        previewChildren={<SkeletonTable rows={4} columns={3} />}
        primaryCta={{ label: 'Sign in', href: '/sign-in' }}
      />
    );
  return <UsageSettingsPage />;
}
