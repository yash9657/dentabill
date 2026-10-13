'use client';

import * as React from 'react';

import type { AuditLogsFilters } from '../../../lib/audit/types.js';
import { AUDIT_RESOURCE_TYPES } from '../../../lib/audit/types.js';
import { useAuditLogs } from '../../../lib/audit/use-audit-logs.js';

import { AuditLogTable } from './audit-log-table.js';

/**
 * The audit log viewer for `/dashboard/settings/audit-log`.
 *
 * Displays a paginated table of all audit events in the organization,
 * filterable by resource type and date range. Each row is clickable to
 * expand metadata in a side drawer.
 *
 * The "no black box, every AI decision is auditable" moment: auto-transition
 * entries surface summaryId, confidence, and promptVersion prominently in the
 * drawer metadata.
 */
export function AuditLogPage(): React.ReactElement {
  const [filters, setFilters] = React.useState<AuditLogsFilters>({});

  const { data, isLoading, error, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useAuditLogs(filters);

  // Flatten pages into a single items array for the table component.
  const items = React.useMemo(
    () => (data?.pages ? data.pages.flatMap((page) => page.items) : []),
    [data?.pages],
  );

  const errorMessage = error?.message ?? null;

  return (
    <div className="space-y-6">
      {/* Filter section */}
      <div className="rounded-card hairline-edge space-y-4 bg-white p-6">
        <div>
          <h2 className="font-body text-lg font-medium text-black">Filters</h2>
          <p className="text-body text-gray-warm mt-1 text-sm">
            Search audit logs by resource type and date range.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Resource Type Filter */}
          <div>
            <label
              htmlFor="resource-type"
              className="text-caption text-gray-warm text-xs font-medium uppercase tracking-[0.12em]"
            >
              Resource Type
            </label>
            <select
              id="resource-type"
              value={filters.resourceType ?? ''}
              onChange={(e) => {
                setFilters((prev) => ({
                  ...prev,
                  resourceType: e.target.value || undefined,
                }));
              }}
              className="rounded-standard border-border-subtle mt-2 w-full border bg-white px-4 py-2 text-sm text-black"
            >
              <option value="">All Resources</option>
              {AUDIT_RESOURCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          {/* From Date */}
          <div>
            <label
              htmlFor="from-date"
              className="text-caption text-gray-warm text-xs font-medium uppercase tracking-[0.12em]"
            >
              From Date
            </label>
            <input
              id="from-date"
              type="date"
              value={filters.from ?? ''}
              onChange={(e) => {
                setFilters((prev) => ({
                  ...prev,
                  from: e.target.value || undefined,
                }));
              }}
              className="rounded-standard border-border-subtle mt-2 w-full border bg-white px-4 py-2 text-sm text-black"
            />
          </div>

          {/* To Date */}
          <div>
            <label
              htmlFor="to-date"
              className="text-caption text-gray-warm text-xs font-medium uppercase tracking-[0.12em]"
            >
              To Date
            </label>
            <input
              id="to-date"
              type="date"
              value={filters.to ?? ''}
              onChange={(e) => {
                setFilters((prev) => ({
                  ...prev,
                  to: e.target.value || undefined,
                }));
              }}
              className="rounded-standard border-border-subtle mt-2 w-full border bg-white px-4 py-2 text-sm text-black"
            />
          </div>
        </div>

        {/* Clear filters button */}
        {Object.values(filters).some((v) => v !== undefined) ? (
          <button
            onClick={() => {
              setFilters({});
            }}
            className="text-gray-warm text-xs font-medium transition-colors hover:text-black"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {/* Table */}
      <AuditLogTable
        items={items}
        isLoading={isLoading}
        isFetchingMore={isFetchingNextPage}
        hasMore={hasNextPage}
        onReachEnd={() => {
          if (hasNextPage && !isFetchingNextPage) {
            void fetchNextPage();
          }
        }}
        errorMessage={errorMessage}
      />
    </div>
  );
}
