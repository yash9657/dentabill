import type { Metadata } from 'next';
import * as React from 'react';

import { DashboardPageStub } from '../../../components/dashboard/index.js';

export const metadata: Metadata = { title: 'Settings' };

export default function DashboardSettingsPage(): React.ReactElement {
  return (
    <DashboardPageStub
      title="Settings"
      nextTaskId="P2-T36 (org / team / billing / integrations / notifications / audit-log subsections)"
      description="Practice details, team members, billing, integrations, notifications, and the audit log will all live under this section."
    />
  );
}
