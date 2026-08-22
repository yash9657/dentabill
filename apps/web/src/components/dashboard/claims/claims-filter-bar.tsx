'use client';

import { Input, cn } from '@dentabill/ui';
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

/**
 * Filter chips + search input for the `/dashboard/claims` table.
 *
 * Status and payer chips are rendered as a horizontally-scrollable
 * row of `<button>`s with `aria-pressed`; "All" clears the filter.
 * The search input is a controlled text field; the parent owns
 * debouncing (the table re-fetches on every filter change, but the
 * page wraps `onChange` in a debounce so a typed query doesn't fire
 * a request per keystroke).
 *
 * Visual language is achromatic per ADR-013: the active chip is a
 * black pill; inactive chips are warm-stone tinted with a hairline
 * edge.
 */
export function ClaimsFilterBar({ filters, onChange }: ClaimsFilterBarProps): React.ReactElement {
  const setStatus = (status: ClaimStatus | undefined): void => {
    const next: ClaimsFilters = { ...filters };
    if (status === undefined) delete (next as { status?: ClaimStatus }).status;
    else (next as { status?: ClaimStatus }).status = status;
    onChange(next);
  };

  const setPayer = (payer: PayerCode | undefined): void => {
    const next: ClaimsFilters = { ...filters };
    if (payer === undefined) delete (next as { payer?: PayerCode }).payer;
    else (next as { payer?: PayerCode }).payer = payer;
    onChange(next);
  };

  const setSearch = (search: string): void => {
    const next: ClaimsFilters = { ...filters };
    const trimmed = search.trim();
    if (trimmed.length === 0) delete (next as { search?: string }).search;
    else (next as { search?: string }).search = trimmed;
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="search"
        inputMode="search"
        placeholder="Search claim number…"
        aria-label="Search claim number"
        value={filters.search ?? ''}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
        className="h-9 sm:max-w-xs"
      />

      <ChipRow label="Status">
        <Chip
          active={filters.status === undefined}
          onClick={() => {
            setStatus(undefined);
          }}
        >
          All
        </Chip>
        {CLAIM_STATUS_OPTIONS.map((status) => (
          <Chip
            key={status}
            active={filters.status === status}
            onClick={() => {
              setStatus(status);
            }}
          >
            {statusLabel(status)}
          </Chip>
        ))}
      </ChipRow>

      <ChipRow label="Payer">
        <Chip
          active={filters.payer === undefined}
          onClick={() => {
            setPayer(undefined);
          }}
        >
          All
        </Chip>
        {PAYER_OPTIONS.map((payer) => (
          <Chip
            key={payer}
            active={filters.payer === payer}
            onClick={() => {
              setPayer(payer);
            }}
          >
            {payerLabel(payer)}
          </Chip>
        ))}
      </ChipRow>
    </div>
  );
}

/**
 * Two-column layout: a fixed-width label column on the left,
 * a flex-wrap row of chips on the right. The label widths are
 * identical across all ChipRow instances (controlled by the
 * `[60px_…]` track), so the first chip on every row aligns
 * vertically and overflowing chips wrap to a new line that
 * starts directly under the first chip — never under the label.
 */
function ChipRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-[60px_1fr] items-start gap-x-3">
      <span aria-hidden className="text-caption text-gray-warm pt-1 uppercase tracking-[0.14em]">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-pill h-7 px-2.5 text-[13px] font-medium transition-colors',
        active
          ? 'bg-black text-white'
          : 'hairline-edge bg-warm-stone/40 text-gray-dark hover:bg-warm-stone/60',
      )}
    >
      {children}
    </button>
  );
}
