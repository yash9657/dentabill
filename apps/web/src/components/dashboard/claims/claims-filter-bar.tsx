'use client';

import { Button, Input, Select } from '@dentabill/ui';
import { Search, X } from 'lucide-react';
import * as React from 'react';

import {
  CLAIM_STATUS_OPTIONS,
  PAYER_OPTIONS,
  payerLabel,
  statusLabel,
  type ClaimsFilters,
  type ClaimStatus,
  type PayerCode,
} from '../../../lib/claims/types.js';

export interface ClaimsFilterBarProps {
  readonly filters: ClaimsFilters;
  readonly onChange: (next: ClaimsFilters) => void;
}
export function ClaimsFilterBar({ filters, onChange }: ClaimsFilterBarProps): React.ReactElement {
  const searchId = React.useId();
  const set = (key: keyof ClaimsFilters, value: string): void => {
    const next = { ...filters };
    if (!value) {
      if (key === 'status') delete next.status;
      else if (key === 'payer') delete next.payer;
      else delete next.search;
    } else if (key === 'status') next.status = value as ClaimStatus;
    else if (key === 'payer') next.payer = value as PayerCode;
    else next.search = value;
    onChange(next);
  };
  return (
    <div
      role="search"
      aria-label="Filter claims"
      className="rounded-card border-border-light flex flex-wrap items-end gap-3 border bg-white p-4"
    >
      <label
        htmlFor={searchId}
        className="text-gray-dark min-w-0 basis-full text-xs font-medium sm:min-w-[200px] sm:flex-1 sm:basis-auto"
      >
        Claim number
        <div className="relative mt-2">
          <Search
            size={16}
            aria-hidden
            className="text-gray-warm pointer-events-none absolute left-3 top-3.5"
          />
          <Input
            id={searchId}
            type="search"
            inputMode="search"
            placeholder="Search claim number…"
            aria-label="Search claim number"
            value={filters.search ?? ''}
            onChange={(event) => {
              set('search', event.target.value.trim());
            }}
            className="pl-9"
          />
        </div>
      </label>
      <label className="text-gray-dark min-w-0 flex-1 text-xs font-medium sm:flex-none">
        Status
        <Select
          aria-label="Status"
          value={filters.status ?? ''}
          onChange={(event) => {
            set('status', event.target.value);
          }}
          className="mt-2 w-full sm:w-40"
        >
          <option value="">All statuses</option>
          {CLAIM_STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
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
          className="mt-2 w-full sm:w-48"
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
