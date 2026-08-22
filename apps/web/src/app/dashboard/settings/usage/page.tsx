import type { Metadata } from 'next';
import * as React from 'react';

import { UsageSettingsPage } from '../../../../components/dashboard/settings/usage-settings-page.js';

export const metadata: Metadata = { title: 'Usage · Settings' };

export default function SettingsUsagePage(): React.ReactElement {
  return <UsageSettingsPage />;
}
