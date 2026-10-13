import type { Metadata } from 'next';
import * as React from 'react';

import { DashboardEmptyState, SkeletonList } from '../../../../components/dashboard/index.js';

export const metadata: Metadata = { title: 'Integrations · Settings' };

export default function SettingsIntegrationsPage(): React.ReactElement {
  return (
    <DashboardEmptyState
      eyebrow="Integrations"
      title="Connect Dentrix, Eaglesoft, or Open Dental"
      body="Bring your claims across with a CSV export. Direct connections are not available yet; CSV import works with all three systems today."
      previewChildren={<SkeletonList rows={3} />}
      primaryCta={{ label: 'Import claims', href: '/dashboard/claims/import' }}
      secondaryCta={{ label: 'See security', href: '/security' }}
    />
  );
}
