import type { Metadata } from 'next';
import * as React from 'react';

import { CallDetailPage } from '../../../../components/dashboard/calls/call-detail-page.js';

export const metadata: Metadata = { title: 'Call detail' };

export default async function DashboardCallDetailRoute({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  return <CallDetailPage id={id} />;
}
