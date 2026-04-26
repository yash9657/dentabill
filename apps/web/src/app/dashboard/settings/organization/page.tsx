import type { Metadata } from 'next';
import * as React from 'react';

import { DashboardEmptyState, SkeletonForm } from '../../../../components/dashboard/index.js';

export const metadata: Metadata = { title: 'Organization · Settings' };

export default function SettingsOrganizationPage(): React.ReactElement {
  return (
    <DashboardEmptyState
      eyebrow="Organization"
      title="Practice details"
      body="Your practice name, NPI, address, and the payers you accept. Captured during onboarding (P2-T30) and editable here once the API write endpoints land."
      previewChildren={<SkeletonForm fields={5} />}
      primaryCta={{ label: 'Open onboarding', href: '/onboarding' }}
    />
  );
}
