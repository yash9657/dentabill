'use client';

import * as React from 'react';

import { useReportsSummary } from '../../../lib/reports/use-reports-summary.js';
import type {
  WeekBucket,
  DenialReason,
  PayerOutcome,
  ClaimAgingBucket,
} from '../../../lib/reports/use-reports-summary.js';

/**
 * `<ReportsPage>` — the reports dashboard showing:
 *
 * 1. Call activity by week (line chart, 8 weeks)
 * 2. Denial reasons breakdown (horizontal bar chart)
 * 3. Per-payer performance (horizontal bar chart)
 * 4. Claim aging distribution (data table)
 *
 * Responsive HTML bars preserve full labels at every width. On phones,
 * the call-activity table replaces the SVG trend to keep dates legible.
 * Loading and error states handled inline with em-dash placeholders.
 */

function formatWeekLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${month}/${day}`;
}

/**
 * Line chart: call activity by week (last 8 weeks).
 * Semantic brand marks, with an equivalent data table below.
 */
function CallActivityByWeekChart({
  data,
  isLoading,
}: {
  data: WeekBucket[] | null;
  isLoading: boolean;
}): React.ReactElement {
  const chartWidth = 600;
  const chartHeight = 250;
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  if (isLoading || !data || data.length === 0) {
    return (
      <div className="border-border-light rounded-card min-w-0 border bg-white p-6">
        <h3 className="font-body text-xl font-medium text-black">Call activity by week</h3>
        <div className="text-gray-dark mt-4 flex h-64 items-center justify-center text-sm">
          {isLoading ? 'Loading chart…' : 'No data available'}
        </div>
      </div>
    );
  }

  // Find max value for scaling
  const maxCalls = Math.max(...data.map((d) => d.callCount), 1);
  const pixelsPerCall = innerHeight / maxCalls;

  // Calculate points
  const points: { x: number; y: number; label: string; value: number }[] = [];
  data.forEach((week, i) => {
    const x = padding.left + (i / Math.max(data.length - 1, 1)) * innerWidth;
    const y = padding.top + innerHeight - week.callCount * pixelsPerCall;
    points.push({
      x,
      y,
      label: formatWeekLabel(week.weekStart),
      value: week.callCount,
    });
  });

  // SVG path for line
  const pathD = points
    .map((p, i) =>
      i === 0 ? `M ${String(p.x)} ${String(p.y)}` : `L ${String(p.x)} ${String(p.y)}`,
    )
    .join(' ');

  return (
    <div className="border-border-light rounded-card min-w-0 border bg-white p-6">
      <h3 className="font-body text-xl font-medium text-black">Call activity by week</h3>
      <p className="text-gray-dark mt-2 text-sm">
        Calls started in each UTC week. A claim may appear in more than one week.
      </p>
      <svg
        viewBox={`0 0 ${String(chartWidth)} ${String(chartHeight)}`}
        className="mt-6 hidden h-auto w-full sm:block"
        role="img"
        aria-label="Call activity trend over 8 weeks"
      >
        <defs>
          <style>{`
            .chart-line { stroke: var(--color-brand); stroke-width: 2; fill: none; }
            .chart-dot { fill: var(--color-brand); }
            .chart-text { font-family: var(--font-body), Inter, system-ui, sans-serif; font-size: 12px; fill: var(--color-gray-dark); }
            .chart-axis { stroke: var(--color-border-light); stroke-width: 1; }
          `}</style>
        </defs>

        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map((pct) => (
          <line
            key={`grid-${String(pct)}`}
            x1={padding.left}
            y1={padding.top + innerHeight * (1 - pct)}
            x2={padding.left + innerWidth}
            y2={padding.top + innerHeight * (1 - pct)}
            className="chart-axis"
            opacity={0.3}
          />
        ))}

        {/* Axes */}
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={padding.top + innerHeight}
          className="chart-axis"
        />
        <line
          x1={padding.left}
          y1={padding.top + innerHeight}
          x2={chartWidth - padding.right}
          y2={padding.top + innerHeight}
          className="chart-axis"
        />

        {/* Line path */}
        <path d={pathD} className="chart-line" />

        {/* Data points */}
        {points.map((p, i) => (
          <circle key={`point-${String(i)}`} cx={p.x} cy={p.y} r={3} className="chart-dot" />
        ))}

        {/* X-axis labels */}
        {points.map((p, i) => (
          <text
            key={`label-${String(i)}`}
            x={p.x}
            y={padding.top + innerHeight + 25}
            textAnchor="middle"
            className="chart-text"
          >
            {p.label}
          </text>
        ))}

        {/* Y-axis labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const value = Math.round(maxCalls * pct);
          const y = padding.top + innerHeight * (1 - pct);
          return (
            <text
              key={`yaxis-${String(pct)}`}
              x={padding.left - 8}
              y={y + 4}
              textAnchor="end"
              className="chart-text"
              fontSize={11}
            >
              {String(value)}
            </text>
          );
        })}
      </svg>

      {/* Data table for accessibility */}
      <div className="border-border-light mt-4 border-t pt-4">
        <table className="text-sm" role="presentation">
          <tbody>
            {data.map((week) => (
              <tr key={week.weekStart} className="border-gray-light border-b py-2">
                <td className="text-gray-dark py-2 pr-4">{formatWeekLabel(week.weekStart)}</td>
                <td className="py-2 pr-4 font-medium text-black">
                  {`${String(week.callCount)} calls`}
                </td>
                <td className="text-gray-warm">
                  {String(week.completedCallCount)} completed · {String(week.uniqueClaimCount)}{' '}
                  unique claims
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Horizontal bar chart: denial reasons, sorted by count.
 * Text labels remain in normal document flow so they can wrap.
 */
function DenialReasonsChart({
  data,
  isLoading,
}: {
  data: DenialReason[] | null;
  isLoading: boolean;
}): React.ReactElement {
  if (isLoading || !data || data.length === 0) {
    return (
      <div className="border-border-light rounded-card min-w-0 border bg-white p-6">
        <h3 className="font-body text-xl font-medium text-black">Top denial reasons</h3>
        <div className="text-gray-dark mt-4 flex h-40 items-center justify-center text-sm">
          {isLoading ? 'Loading chart…' : 'No denials recorded'}
        </div>
      </div>
    );
  }

  const maxCount = Math.max(...data.map((reason) => reason.uniqueClaimCount), 1);
  return (
    <div className="border-border-light rounded-card min-w-0 border bg-white p-6">
      <h3 className="font-body text-xl font-medium text-black">Top denial reasons</h3>
      <p className="text-gray-dark mt-2 text-sm">
        Distinct claims per reported code; a claim may appear in multiple groups.
      </p>
      <ul className="mt-6 space-y-6">
        {data.map((reason) => (
          <li key={reason.code}>
            <div className="flex items-baseline justify-between gap-4 text-sm">
              <span className="text-gray-dark min-w-0 break-words">{reason.label}</span>
              <span className="shrink-0 font-medium tabular-nums text-black">
                {String(reason.uniqueClaimCount)}
              </span>
            </div>
            <div className="bg-gray-light mt-2 h-2 overflow-hidden rounded-full" aria-hidden="true">
              <div
                className="bg-brand h-full rounded-full"
                style={{ width: `${String((reason.uniqueClaimCount / maxCount) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Horizontal bar chart: per-payer distinct claims with calls.
 * Text labels remain in normal document flow so they can wrap.
 */
function PayerOutcomesChart({
  data,
  isLoading,
}: {
  data: PayerOutcome[] | null;
  isLoading: boolean;
}): React.ReactElement {
  if (isLoading || !data || data.length === 0) {
    return (
      <div className="border-border-light rounded-card min-w-0 border bg-white p-6">
        <h3 className="font-body text-xl font-medium text-black">Payer call activity</h3>
        <div className="text-gray-dark mt-4 flex h-40 items-center justify-center text-sm">
          {isLoading ? 'Loading chart…' : 'No payer data available'}
        </div>
      </div>
    );
  }

  const maxClaims = Math.max(...data.map((payer) => payer.uniqueClaimCount), 1);
  return (
    <div className="border-border-light rounded-card min-w-0 border bg-white p-6">
      <h3 className="font-body text-xl font-medium text-black">Payer call activity</h3>
      <ul className="mt-6 space-y-6">
        {data.map((payer) => (
          <li key={payer.payer}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
              <span className="min-w-0 break-words font-medium text-black">{payer.payer}</span>
              <span className="text-brand font-semibold tabular-nums">
                {String(payer.uniqueClaimCount)} unique claims
              </span>
            </div>
            <div className="bg-gray-light mt-2 h-2 overflow-hidden rounded-full" aria-hidden="true">
              <div
                className="bg-brand h-full rounded-full"
                style={{ width: `${String((payer.uniqueClaimCount / maxClaims) * 100)}%` }}
              />
            </div>
            <p className="text-gray-dark mt-2 text-xs leading-relaxed">
              {String(payer.callCount)} calls · {String(payer.completedCallCount)} completed
              {payer.avgDurationSeconds !== null ? (
                <>
                  {' '}
                  · Avg {String(Math.floor(payer.avgDurationSeconds / 60))}m{' '}
                  {String(payer.avgDurationSeconds % 60)}s
                </>
              ) : null}
            </p>
            <p className="text-gray-dark mt-1 text-xs leading-relaxed">
              {String(payer.claimsMarkedResolvedCount)} of {String(payer.uniqueClaimCount)} claims
              marked resolved. Workflow status only; payment is unverified.
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Claim aging distribution table.
 */
function ClaimAgingTable({
  data,
  isLoading,
}: {
  data: ClaimAgingBucket[] | null;
  isLoading: boolean;
}): React.ReactElement {
  if (isLoading || !data || data.length === 0) {
    return (
      <div className="border-border-light rounded-card min-w-0 border bg-white p-6">
        <h3 className="font-body text-xl font-medium text-black">Claim aging</h3>
        <div className="text-gray-dark mt-4 flex h-40 items-center justify-center text-sm">
          {isLoading ? 'Loading table…' : 'No claims pending'}
        </div>
      </div>
    );
  }

  const totalClaims = data.reduce((sum, b) => sum + b.count, 0);

  return (
    <div className="border-border-light rounded-card min-w-0 border bg-white p-6">
      <h3 className="font-body text-xl font-medium text-black">Claim aging</h3>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border-light border-b">
              <th className="px-4 py-3 text-left font-medium text-black">Age bucket</th>
              <th className="px-4 py-3 text-right font-medium text-black">Count</th>
              <th className="px-4 py-3 text-right font-medium text-black">Percentage</th>
            </tr>
          </thead>
          <tbody>
            {data.map((bucket) => {
              const pct = totalClaims > 0 ? ((bucket.count / totalClaims) * 100).toFixed(1) : '0';
              return (
                <tr key={bucket.bucket} className="border-gray-light hover:bg-gray-light border-b">
                  <td className="text-gray-dark px-4 py-3">
                    {bucket.bucket === '0-7' && 'Fresh (0-7 days)'}
                    {bucket.bucket === '8-14' && 'Recent (8-14 days)'}
                    {bucket.bucket === '15-30' && 'Aging (15-30 days)'}
                    {bucket.bucket === '31-60' && 'Overdue (31-60 days)'}
                    {bucket.bucket === '60+' && 'Critical (60+ days)'}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-black">
                    {String(bucket.count)}
                  </td>
                  <td className="text-gray-dark px-4 py-3 text-right">{pct}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ReportsPage(): React.ReactElement {
  const query = useReportsSummary();
  const data = query.data;

  return (
    <div className="flex flex-col gap-8">
      <header className="max-w-3xl">
        <h1 className="font-body text-[28px] font-medium leading-[1.15] tracking-[-0.01em] text-black sm:text-[32px]">
          Reports
        </h1>
        <p className="text-body text-gray-dark mt-2">
          Call activity, reported denials, and claim aging.
        </p>
      </header>

      <p className="text-gray-dark text-sm" role="note">
        Verified payments unavailable. Payments, posting, settlement, and recovery have not been
        reconciled.
      </p>

      {query.isError && (
        <div
          role="alert"
          className="border-border-light bg-gray-light text-gray-dark rounded-lg border p-4 text-sm"
        >
          Couldn&apos;t load reports — {query.error.message}
        </div>
      )}

      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <CallActivityByWeekChart
          data={data?.callActivityByWeek ?? null}
          isLoading={query.isLoading}
        />
        <DenialReasonsChart data={data?.denialReasons ?? null} isLoading={query.isLoading} />
      </div>

      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <PayerOutcomesChart data={data?.payerOutcomes ?? null} isLoading={query.isLoading} />
        <ClaimAgingTable data={data?.claimAging ?? null} isLoading={query.isLoading} />
      </div>
    </div>
  );
}
