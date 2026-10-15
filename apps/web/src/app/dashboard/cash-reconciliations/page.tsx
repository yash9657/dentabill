import type { Metadata } from 'next';
import * as React from 'react';

import { CashReconciliationsPage } from '../../../components/dashboard/cash-reconciliations/cash-reconciliations-page.js';

export const metadata: Metadata = { title: 'Cash reconciliation' };

export default function DashboardCashReconciliationsRoute(): React.ReactElement {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
    return (
      <>
        <h1 className="font-body text-[28px] font-semibold leading-[1.15] text-black sm:text-[32px]">
          Cash reconciliation
        </h1>
        <p className="text-gray-dark mt-3">Sign in to review cash source matches and releases.</p>
      </>
    );
  return <CashReconciliationsPage />;
}
