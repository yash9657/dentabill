import type { Metadata } from 'next';
import * as React from 'react';

import { DashboardEmptyState, SkeletonList } from '../../../../components/dashboard/index.js';

export const metadata: Metadata = { title: 'Integrations · Settings' };

export default function SettingsIntegrationsPage(): React.ReactElement {
  return (
    <DashboardEmptyState
      eyebrow="Integrations"
      title="Connect Dentrix, Eaglesoft, or Open Dental"
      body="CSV export is available now — import claims at /dashboard/claims/import. Direct PMS sync via API is coming soon with full change-data-capture support."
      previewChildren={<SkeletonList rows={3} />}
      primaryCta={{ label: 'Import claims', href: '/dashboard/claims/import' }}
      secondaryCta={{ label: 'See security', href: '/security' }}
    />
  );
}
