import type { Metadata } from 'next';
import * as React from 'react';

import { ClaimsListPage } from '../../../components/dashboard/claims/claims-list-page.js';

export const metadata: Metadata = { title: 'Claims' };

export default function DashboardClaimsPageRoute(): React.ReactElement {
  return <ClaimsListPage />;
}
