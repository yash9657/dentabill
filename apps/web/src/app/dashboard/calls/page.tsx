import type { Metadata } from 'next';
import * as React from 'react';

import { CallsListPage } from '../../../components/dashboard/calls/calls-list-page.js';

export const metadata: Metadata = { title: 'Calls' };

export default function DashboardCallsPage(): React.ReactElement {
  return <CallsListPage />;
}
