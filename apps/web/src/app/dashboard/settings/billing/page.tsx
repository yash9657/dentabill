import type { Metadata } from 'next';
import * as React from 'react';

import { BillingSettingsPage } from '../../../../components/dashboard/settings/billing-settings-page.js';

export const metadata: Metadata = { title: 'Billing · Settings' };

export default function SettingsBillingPage(): React.ReactElement {
  return <BillingSettingsPage />;
}
