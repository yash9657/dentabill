'use client';

import { StatTile } from '@dentabill/ui';
import * as React from 'react';

import {
  formatCents,
  useBillingUsage,
  type BillingUsageItem,
} from '../../../lib/billing/use-billing.js';

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
}

function UsageRow({ item }: { readonly item: BillingUsageItem }): React.ReactElement {
  return (
    <li className="hairline-edge rounded-card flex items-center justify-between bg-white px-4 py-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-body text-gray-dark font-mono text-xs">{item.claimId}</span>
        <span className="text-caption text-gray-warm">
          {formatDate(item.billingPeriodStart)}
          {item.postedAt ? ' · posted' : ' · pending'}
        </span>
      </div>
      <span className="text-body text-gray-dark font-medium">{formatCents(item.amountCents)}</span>
    </li>
  );
}

export function UsageSettingsPage(): React.ReactElement {
  const usage = useBillingUsage();

  return (
    <div className="flex flex-col gap-6">
      <div className="hairline-edge rounded-card flex flex-col gap-4 bg-white p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-[20px] font-light leading-[1.2] tracking-[-0.01em] text-black">
            Usage
          </h2>
          <p className="text-caption text-gray-warm">
            Track your claim follow-ups and see how much time DentaBill is saving your team.
          </p>
        </div>
      </div>

      <div className="hairline-edge rounded-card grid grid-cols-1 gap-4 bg-white p-6 sm:grid-cols-2">
        <StatTile
          label="This month"
          value={usage.isPending ? '—' : formatCents(usage.data?.currentMonthCents ?? 0)}
        />
        <StatTile
          label="Last 90 days"
          value={usage.isPending ? '—' : formatCents(usage.data?.last90DaysCents ?? 0)}
        />
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-body text-gray-dark font-medium">Recent usage</h3>
        {usage.isPending ? (
          <p className="text-caption text-gray-warm">Loading usage records…</p>
        ) : usage.isError ? (
          <p role="alert" className="text-caption text-gray-dark">
            {usage.error.message || 'Could not load usage.'}
          </p>
        ) : usage.data.items.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {usage.data.items.map((item) => (
              <UsageRow key={item.id} item={item} />
            ))}
          </ul>
        ) : (
          <p className="text-caption text-gray-warm">
            No usage yet. Your first claim follow-up will appear here.
          </p>
        )}
      </div>
    </div>
  );
}
