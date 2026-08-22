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
 * 1. Recovered value by week (line chart, 8 weeks)
 * 2. Denial reasons breakdown (horizontal bar chart)
 * 3. Per-payer performance (horizontal bar chart)
 * 4. Claim aging distribution (data table)
 *
 * Charts are inline SVG drawn from the achromatic token palette —
 * marks differentiate by value, position, and label rather than by
 * hue, since ADR-013 reserves the one teal accent for live calls.
 * Loading and error states handled inline with em-dash placeholders.
 */

function formatCents(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function formatWeekLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${month}/${day}`;
}

/**
 * Line chart: recovered value by week (last 8 weeks).
 * Achromatic design with black marks and warm-gray labels.
 */
function RecoveredByWeekChart({
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
      <div className="border-border-light rounded-lg border bg-white p-6">
        <h3 className="font-display text-xl font-light text-black">Recovered value by week</h3>
        <div className="text-gray-dark mt-4 flex h-64 items-center justify-center text-sm">
          {isLoading ? 'Loading chart…' : 'No data available'}
        </div>
      </div>
    );
  }

  // Find max value for scaling
  const maxCents = Math.max(...data.map((d) => d.recoveredCents), 1);
  const pixelsPerCent = innerHeight / maxCents;

  // Calculate points
  const points: { x: number; y: number; label: string; value: number }[] = [];
  data.forEach((week, i) => {
    const x = padding.left + (i / (data.length - 1)) * innerWidth;
    const y = padding.top + innerHeight - week.recoveredCents * pixelsPerCent;
    points.push({
      x,
      y,
      label: formatWeekLabel(week.weekStart),
      value: week.recoveredCents,
    });
  });

  // SVG path for line
  const pathD = points
    .map((p, i) =>
      i === 0 ? `M ${String(p.x)} ${String(p.y)}` : `L ${String(p.x)} ${String(p.y)}`,
    )
    .join(' ');

  return (
    <div className="border-border-light rounded-lg border bg-white p-6">
      <h3 className="font-display text-xl font-light text-black">Recovered value by week</h3>
      <svg
        width={chartWidth}
        height={chartHeight}
        className="mt-6"
        role="img"
        aria-label="Recovered value trend over 8 weeks"
      >
        <defs>
          <style>{`
            .chart-line { stroke: oklch(0 0 0); stroke-width: 2; fill: none; }
            .chart-dot { fill: oklch(0 0 0); }
            .chart-text { font-family: var(--font-body), Inter, system-ui, sans-serif; font-size: 12px; fill: oklch(0.529 0.013 70); }
            .chart-axis { stroke: oklch(0.911 0 0); stroke-width: 1; }
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
          const value = Math.round(maxCents * pct);
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
              {formatCents(value)}
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
                  {formatCents(week.recoveredCents)}
                </td>
                <td className="text-gray-warm">{String(week.claimCount)} claims</td>
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
 * Achromatic design with black bars and warm-gray labels.
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
      <div className="border-border-light rounded-lg border bg-white p-6">
        <h3 className="font-display text-xl font-light text-black">Top denial reasons</h3>
        <div className="text-gray-dark mt-4 flex h-40 items-center justify-center text-sm">
          {isLoading ? 'Loading chart…' : 'No denials recorded'}
        </div>
      </div>
    );
  }

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const chartHeight = data.length * 40 + 40;
  const barHeight = 28;

  return (
    <div className="border-border-light rounded-lg border bg-white p-6">
      <h3 className="font-display text-xl font-light text-black">Top denial reasons</h3>
      <svg
        width={500}
        height={chartHeight}
        className="mt-6"
        role="img"
        aria-label={`${String(data.length)} denial reasons by frequency`}
      >
        <defs>
          <style>{`
            .bar { fill: oklch(0 0 0); }
            .bar-label { font-family: var(--font-body), Inter, system-ui, sans-serif; font-size: 12px; fill: oklch(0.529 0.013 70); }
            .bar-value { font-family: var(--font-body), Inter, system-ui, sans-serif; font-size: 13px; font-weight: 500; fill: oklch(0 0 0); }
          `}</style>
        </defs>

        {data.map((reason, i) => {
          const y = i * 40 + 20;
          const barWidth = (reason.count / maxCount) * 350;
          return (
            <g key={reason.code}>
              <rect x={80} y={y} width={barWidth} height={barHeight} className="bar" rx={2} />
              <text x={75} y={y + barHeight / 2 + 4} textAnchor="end" className="bar-label">
                {reason.label}
              </text>
              <text x={85 + barWidth} y={y + barHeight / 2 + 4} className="bar-value">
                {String(reason.count)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Data list for accessibility */}
      <div className="border-border-light mt-4 space-y-2 border-t pt-4">
        {data.map((reason) => (
          <div key={reason.code} className="flex justify-between text-sm">
            <span className="text-gray-dark">{reason.label}</span>
            <span className="font-medium text-black">{String(reason.count)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Horizontal bar chart: per-payer recovered amount.
 * Achromatic design with black bars and warm-gray labels.
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
      <div className="border-border-light rounded-lg border bg-white p-6">
        <h3 className="font-display text-xl font-light text-black">Per-payer recovery</h3>
        <div className="text-gray-dark mt-4 flex h-40 items-center justify-center text-sm">
          {isLoading ? 'Loading chart…' : 'No payer data available'}
        </div>
      </div>
    );
  }

  const maxRecovered = Math.max(...data.map((d) => d.recoveredCents), 1);
  const chartHeight = data.length * 50 + 40;
  const barHeight = 32;

  return (
    <div className="border-border-light rounded-lg border bg-white p-6">
      <h3 className="font-display text-xl font-light text-black">Per-payer recovery</h3>
      <svg
        width={550}
        height={chartHeight}
        className="mt-6"
        role="img"
        aria-label={`Recovered amounts by ${String(data.length)} payers`}
      >
        <defs>
          <style>{`
            .payer-bar { fill: oklch(0 0 0); }
            .payer-label { font-family: var(--font-body), Inter, system-ui, sans-serif; font-size: 12px; fill: oklch(0.529 0.013 70); }
            .payer-value { font-family: var(--font-body), Inter, system-ui, sans-serif; font-size: 13px; font-weight: 500; fill: oklch(0 0 0); }
          `}</style>
        </defs>

        {data.map((payer, i) => {
          const y = i * 50 + 20;
          const barWidth = (payer.recoveredCents / maxRecovered) * 350;
          return (
            <g key={payer.payer}>
              <rect
                x={100}
                y={y}
                width={barWidth}
                height={barHeight}
                className="payer-bar"
                rx={2}
              />
              <text x={95} y={y + barHeight / 2 + 4} textAnchor="end" className="payer-label">
                {payer.payer}
              </text>
              <text x={105 + barWidth} y={y + barHeight / 2 + 4} className="payer-value">
                {formatCents(payer.recoveredCents)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Data table for accessibility */}
      <div className="border-border-light mt-4 space-y-3 border-t pt-4">
        {data.map((payer) => (
          <div key={payer.payer} className="space-y-1">
            <div className="flex justify-between">
              <span className="font-medium text-black">{payer.payer}</span>
              <span className="text-gray-dark text-sm">{String(payer.callCount)} calls</span>
            </div>
            <div className="text-sm">
              <span className="text-gray-dark">Recovered: </span>
              <span className="font-medium text-black">{formatCents(payer.recoveredCents)}</span>
              <span className="text-gray-dark ml-2">({String(payer.resolvedCount)} resolved)</span>
            </div>
            {payer.avgDurationSeconds && (
              <div className="text-gray-warm text-xs">
                Avg duration: {String(Math.round(payer.avgDurationSeconds / 60))}m{' '}
                {String(payer.avgDurationSeconds % 60)}s
              </div>
            )}
          </div>
        ))}
      </div>
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
      <div className="border-border-light rounded-lg border bg-white p-6">
        <h3 className="font-display text-xl font-light text-black">Claim aging</h3>
        <div className="text-gray-dark mt-4 flex h-40 items-center justify-center text-sm">
          {isLoading ? 'Loading table…' : 'No claims pending'}
        </div>
      </div>
    );
  }

  const totalClaims = data.reduce((sum, b) => sum + b.count, 0);

  return (
    <div className="border-border-light rounded-lg border bg-white p-6">
      <h3 className="font-display text-xl font-light text-black">Claim aging</h3>
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
        <h1 className="font-display text-[28px] font-light leading-[1.15] tracking-[-0.01em] text-black sm:text-[32px]">
          Reports
        </h1>
        <p className="text-body text-gray-dark mt-2">
          Recovery trends, denial analysis, payer performance, and aging distribution.
        </p>
      </header>

      {query.isError && (
        <div
          role="alert"
          className="border-border-light bg-gray-light text-gray-dark rounded-lg border p-4 text-sm"
        >
          Couldn&apos;t load reports — {query.error.message}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        <RecoveredByWeekChart data={data?.recoveredByWeek ?? null} isLoading={query.isLoading} />
        <DenialReasonsChart data={data?.denialReasons ?? null} isLoading={query.isLoading} />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <PayerOutcomesChart data={data?.payerOutcomes ?? null} isLoading={query.isLoading} />
        <ClaimAgingTable data={data?.claimAging ?? null} isLoading={query.isLoading} />
      </div>
    </div>
  );
}
