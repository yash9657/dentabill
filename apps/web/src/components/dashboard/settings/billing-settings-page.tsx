'use client';

import { Button } from '@dentabill/ui';
import * as React from 'react';

import {
  formatCents,
  useBillingUsage,
  useOpenBillingPortal,
  type BillingUsageItem,
} from '../../../lib/billing/use-billing.js';
import { useMe } from '../../../lib/me/use-me.js';

const PORTAL_ROLES = new Set(['OWNER', 'ADMIN']);

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
}

function UsageRow({ item }: { item: BillingUsageItem }): React.ReactElement {
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

export function BillingSettingsPage(): React.ReactElement {
  const me = useMe();
  const usage = useBillingUsage();
  const portal = useOpenBillingPortal();

  const role = me.data?.user.role;
  const canOpenPortal = role !== undefined && PORTAL_ROLES.has(role);

  const handlePortal = React.useCallback(async () => {
    portal.reset();
    try {
      const result = await portal.mutateAsync();
      if (typeof window !== 'undefined') {
        window.location.assign(result.url);
      }
    } catch {
      // mutation.error is surfaced inline below.
    }
  }, [portal]);

  return (
    <div className="flex flex-col gap-6">
      <div className="hairline-edge rounded-card flex flex-col gap-4 bg-white p-6">
        <div className="flex items-start justify-between gap-6">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-[20px] font-light leading-[1.2] tracking-[-0.01em] text-black">
              Billing
            </h2>
            <p className="text-caption text-gray-warm">
              DentaBill prices per resolved claim. The Stripe Customer Portal is the source of truth
              for payment method, invoices, and plan changes.
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            size="default"
            disabled={!canOpenPortal || portal.isPending}
            onClick={() => {
              void handlePortal();
            }}
          >
            {portal.isPending ? 'Opening…' : 'Manage billing'}
          </Button>
        </div>

        {!canOpenPortal && me.data ? (
          <p className="text-caption text-gray-warm">
            Your role is read-only here. Ask an OWNER or ADMIN to open the billing portal.
          </p>
        ) : null}

        {portal.isError ? (
          <p
            role="alert"
            className="text-caption text-gray-dark hairline-edge rounded-card bg-stone-warm/30 px-3 py-2"
          >
            {portal.error.message || 'Could not open billing portal.'}
          </p>
        ) : null}
      </div>

      <div className="hairline-edge rounded-card grid grid-cols-1 gap-4 bg-white p-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-caption text-gray-warm uppercase tracking-[0.12em]">
            This month
          </span>
          <span className="font-display text-[28px] font-light leading-[1.1] tracking-[-0.01em] text-black">
            {usage.isPending ? '—' : formatCents(usage.data?.currentMonthCents ?? 0)}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-caption text-gray-warm uppercase tracking-[0.12em]">
            Last 90 days
          </span>
          <span className="font-display text-[28px] font-light leading-[1.1] tracking-[-0.01em] text-black">
            {usage.isPending ? '—' : formatCents(usage.data?.last90DaysCents ?? 0)}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-body text-gray-dark font-medium">Recent usage</h3>
        {usage.isPending ? (
          <p className="text-caption text-gray-warm">Loading usage records…</p>
        ) : usage.isError ? (
          <p role="alert" className="text-caption text-gray-dark">
            {usage.error.message || 'Could not load billing usage.'}
          </p>
        ) : usage.data.items.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {usage.data.items.map((item) => (
              <UsageRow key={item.id} item={item} />
            ))}
          </ul>
        ) : (
          <p className="text-caption text-gray-warm">
            No usage yet. The first resolved claim of the month is the first thing you’re billed
            for.
          </p>
        )}
      </div>
    </div>
  );
}
