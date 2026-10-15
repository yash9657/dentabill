import type { Metadata } from 'next';
import * as React from 'react';

import { CashEvidencePage } from '../../../components/dashboard/cash-evidence/cash-evidence-page.js';

export const metadata: Metadata = { title: 'Cash evidence' };

export default function DashboardCashEvidenceRoute(): React.ReactElement {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
    return (
      <>
        <h1 className="font-body text-[28px] font-semibold leading-[1.15] text-black sm:text-[32px]">
          Cash evidence
        </h1>
        <p className="text-gray-dark mt-3">
          Sign in to import and review bank-account source records.
        </p>
      </>
    );
  return <CashEvidencePage />;
}
