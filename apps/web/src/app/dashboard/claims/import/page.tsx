import type { Metadata } from 'next';
import * as React from 'react';

import { ClaimsImportPage } from '../../../../components/dashboard/claims/claims-import-page.js';

export const metadata: Metadata = { title: 'Import claims' };

export default function DashboardClaimsImportRoute(): React.ReactElement {
  return <ClaimsImportPage />;
}
