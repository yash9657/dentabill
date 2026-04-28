'use client';

import * as React from 'react';

import { useCallsStats } from '../../lib/calls/use-calls-stats.js';

import { OverviewStatStrip, type OverviewStat } from './overview-stat-strip.js';

/**
 * `<OverviewKpiTiles>` — replaces the Phase-2 synthetic placeholders
 * on `/dashboard/overview` (P3-T25).
 *
 * Owns one fetch (`/v1/calls/stats`) and renders the four tiles:
 *
 *   - Calls today          — count of Call rows started today (UTC).
 *   - Queue depth          — count of claims in PENDING/IN_QUEUE/CALLING.
 *   - Avg call (last 7d)   — mean Call.durationSeconds, last 7 days.
 *   - Recovered this week  — sum of resolved Claim.claimAmount, last 7d.
 *
 * Pre-load: every tile shows "—" so the strip never reflows when data
 * lands. On error: same em-dash placeholders + a small retry hint
 * under the strip rendered by the parent (no toast system yet).
 *
 * The unauthenticated fallback path (`hasClerkKeys === false`) goes
 * through a *static* placeholder strip rendered by the parent; this
 * component assumes Clerk auth is mounted.
 */
function fmtNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${String(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return `${String(m)}m ${String(s).padStart(2, '0')}s`;
}

function fmtCents(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

export function OverviewKpiTiles(): React.ReactElement {
  const query = useCallsStats();
  const data = query.data;

  const stats: readonly OverviewStat[] = [
    {
      label: 'Calls today',
      value: data ? fmtNumber(data.callsToday) : '—',
      caption: data ? 'Started since 00:00 UTC' : 'Loading…',
    },
    {
      label: 'Queue depth',
      value: data ? fmtNumber(data.queueDepth) : '—',
      caption: 'Pending follow-ups',
    },
    {
      label: 'Avg call (7d)',
      value: data ? fmtDuration(data.avgCallSeconds) : '—',
      caption: 'Last seven days',
    },
    {
      label: 'Recovered (7d)',
      value: data ? fmtCents(data.recoveredThisWeekCents) : '—',
      caption: 'Resolved claims, last seven days',
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <OverviewStatStrip stats={stats} />
      {query.isError ? (
        <p role="alert" className="text-caption text-gray-warm" data-testid="overview-kpi-error">
          Couldn’t refresh dashboard metrics — {query.error.message}
        </p>
      ) : null}
    </div>
  );
}
