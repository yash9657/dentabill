import type { Metadata } from 'next';
import * as React from 'react';

import { AuditLogPage } from '../../../../components/dashboard/settings/audit-log-page.js';

export const metadata: Metadata = { title: 'Audit log · Settings' };

export default function SettingsAuditLogPageRoute(): React.ReactElement {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-light text-black">Audit Log</h1>
        <p className="text-body text-gray-warm mt-2">
          Every read of patient data, recorded. Every AI decision, auditable.
        </p>
      </div>
      <AuditLogPage />
    </div>
  );
}
