import type { Metadata } from 'next';
import * as React from 'react';

import { DashboardEmptyState, SkeletonForm } from '../../../../components/dashboard/index.js';

export const metadata: Metadata = { title: 'Billing · Settings' };

export default function SettingsBillingPage(): React.ReactElement {
  return (
    <DashboardEmptyState
      eyebrow="Billing"
      title="Plan, payment method, and invoices"
      body="DentaBill prices per call (see /pricing). Stripe customer portal lands in Phase 4 — until then your account manager handles plan changes directly."
      previewChildren={<SkeletonForm fields={3} />}
      primaryCta={{ label: 'See pricing', href: '/pricing' }}
      secondaryCta={{ label: 'Contact us', href: '/contact' }}
    />
  );
}
