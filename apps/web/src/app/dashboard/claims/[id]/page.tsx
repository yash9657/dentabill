import type { Metadata } from 'next';
import * as React from 'react';

import { ClaimDetailPage } from '../../../../components/dashboard/claims/claim-detail-page.js';

export const metadata: Metadata = { title: 'Claim detail' };

export default async function DashboardClaimDetailRoute({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  return <ClaimDetailPage id={id} />;
}
