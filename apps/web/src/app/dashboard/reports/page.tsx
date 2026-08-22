import type { Metadata } from 'next';
import * as React from 'react';

import { ReportsPage } from '../../../components/dashboard/reports/reports-page.js';

export const metadata: Metadata = { title: 'Reports' };

export default function DashboardReportsPage(): React.ReactElement {
  return <ReportsPage />;
}
