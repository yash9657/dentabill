import type { Metadata } from 'next';
import * as React from 'react';

import { DashboardEmptyState, SkeletonTable } from '../../../../components/dashboard/index.js';

export const metadata: Metadata = { title: 'Audit log · Settings' };

export default function SettingsAuditLogPage(): React.ReactElement {
  return (
    <DashboardEmptyState
      eyebrow="Audit log"
      title="Every read of patient data, recorded"
      body="The audit() helper is already wired into the API and writes a row for every claim read. The viewer + filter UI here surfaces those rows once the API list endpoint ships."
      previewChildren={<SkeletonTable rows={6} columns={4} />}
      primaryCta={{ label: 'See security', href: '/security' }}
    />
  );
}
