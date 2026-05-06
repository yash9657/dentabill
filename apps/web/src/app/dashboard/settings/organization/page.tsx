import type { Metadata } from 'next';
import * as React from 'react';

import { OrganizationSettingsForm } from '../../../../components/dashboard/settings/organization-settings-form.js';

export const metadata: Metadata = { title: 'Organization · Settings' };

export default function SettingsOrganizationPage(): React.ReactElement {
  return (
    <div className="mt-6 max-w-2xl">
      <OrganizationSettingsForm />
    </div>
  );
}
