import type { Metadata } from 'next';
import * as React from 'react';

import { DashboardEmptyState, SkeletonTable } from '../../../../components/dashboard/index.js';
import { AuditLogPage } from '../../../../components/dashboard/settings/audit-log-page.js';

export const metadata: Metadata = { title: 'Audit log · Settings' };

export default function SettingsAuditLogPageRoute(): React.ReactElement {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
    return (
      <DashboardEmptyState
        eyebrow="Settings"
        title="Audit log"
        body="Sign in to review the activity and access history for your practice."
        previewChildren={<SkeletonTable rows={4} columns={3} />}
        primaryCta={{ label: 'Sign in', href: '/sign-in' }}
      />
    );
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-body text-3xl font-medium text-black">Audit Log</h1>
        <p className="text-body text-gray-warm mt-2">
          Every read of patient data, recorded. Every AI decision, auditable.
        </p>
      </div>
      <AuditLogPage />
    </div>
  );
}
