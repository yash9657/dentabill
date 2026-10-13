'use client';

import { Button, Select } from '@dentabill/ui';
import { X } from 'lucide-react';
import * as React from 'react';

import { CALL_STATUS_OPTIONS, callStatusLabel, type CallStatus } from '../../../lib/calls/types.js';
import { type CallsFilters } from '../../../lib/calls/use-calls-list.js';
import { PAYER_OPTIONS, payerLabel, type PayerCode } from '../../../lib/claims/types.js';

export interface CallsFilterBarProps {
  readonly filters: CallsFilters;
  readonly onChange: (next: CallsFilters) => void;
}
export function CallsFilterBar({ filters, onChange }: CallsFilterBarProps): React.ReactElement {
  const set = (key: keyof CallsFilters, value: string): void => {
    const next = { ...filters };
    if (!value) {
      if (key === 'status') delete next.status;
      else delete next.payer;
    } else if (key === 'status') next.status = value as CallStatus;
    else next.payer = value as PayerCode;
    onChange(next);
  };
  return (
    <div
      role="search"
      aria-label="Filter calls"
      className="rounded-card border-border-light flex flex-wrap items-end gap-3 border bg-white p-4"
    >
      <label className="text-gray-dark min-w-0 flex-1 text-xs font-medium sm:flex-none">
        Status
        <Select
          aria-label="Status"
          value={filters.status ?? ''}
          onChange={(event) => {
            set('status', event.target.value);
          }}
          className="mt-2 w-full sm:w-48"
        >
          <option value="">All statuses</option>
          {CALL_STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {callStatusLabel(status)}
            </option>
          ))}
        </Select>
      </label>
      <label className="text-gray-dark min-w-0 flex-1 text-xs font-medium sm:flex-none">
        Payer
        <Select
          aria-label="Payer"
          value={filters.payer ?? ''}
          onChange={(event) => {
            set('payer', event.target.value);
          }}
          className="mt-2 w-full sm:w-52"
        >
          <option value="">All payers</option>
          {PAYER_OPTIONS.map((payer) => (
            <option key={payer} value={payer}>
              {payerLabel(payer)}
            </option>
          ))}
        </Select>
      </label>
      {Object.values(filters).some(Boolean) ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange({});
          }}
        >
          <X size={14} aria-hidden />
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
