import type { Metadata } from 'next';
import * as React from 'react';

import { DashboardEmptyState, SkeletonForm } from '../../../../components/dashboard/index.js';
import { OrganizationSettingsForm } from '../../../../components/dashboard/settings/organization-settings-form.js';

export const metadata: Metadata = { title: 'Organization · Settings' };

export default function SettingsOrganizationPage(): React.ReactElement {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
    return (
      <DashboardEmptyState
        eyebrow="Organization"
        title="Your practice details"
        body="Sign in to manage your practice name, provider information, and organization settings."
        previewChildren={<SkeletonForm fields={3} />}
        primaryCta={{ label: 'Sign in', href: '/sign-in' }}
      />
    );
  return (
    <div className="mt-6 max-w-2xl">
      <OrganizationSettingsForm />
    </div>
  );
}
