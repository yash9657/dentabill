'use client';

import { cn } from '@dentabill/ui';
import * as React from 'react';

import { CALL_STATUS_OPTIONS, callStatusLabel, type CallStatus } from '../../../lib/calls/types.js';
import { type CallsFilters } from '../../../lib/calls/use-calls-list.js';
import { PAYER_OPTIONS, payerLabel, type PayerCode } from '../../../lib/claims/types.js';

export interface CallsFilterBarProps {
  readonly filters: CallsFilters;
  readonly onChange: (next: CallsFilters) => void;
}

export function CallsFilterBar({ filters, onChange }: CallsFilterBarProps): React.ReactElement {
  const setStatus = (status: CallStatus | undefined): void => {
    const next: CallsFilters = { ...filters };
    if (status === undefined) delete (next as { status?: CallStatus }).status;
    else (next as { status?: CallStatus }).status = status;
    onChange(next);
  };

  const setPayer = (payer: PayerCode | undefined): void => {
    const next: CallsFilters = { ...filters };
    if (payer === undefined) delete (next as { payer?: PayerCode }).payer;
    else (next as { payer?: PayerCode }).payer = payer;
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-4">
      <ChipRow label="Status">
        <Chip
          active={filters.status === undefined}
          onClick={() => {
            setStatus(undefined);
          }}
        >
          All
        </Chip>
        {CALL_STATUS_OPTIONS.map((status) => (
          <Chip
            key={status}
            active={filters.status === status}
            onClick={() => {
              setStatus(status);
            }}
          >
            {callStatusLabel(status)}
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

function ChipRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption text-gray-warm uppercase tracking-[0.14em]">{label}</p>
      <div role="group" aria-label={label} className="-mx-1 flex flex-wrap gap-2 px-1">
        {children}
      </div>
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
        'rounded-pill h-8 px-3 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
        active
          ? 'bg-black text-white'
          : 'hairline-edge bg-stone-warm/40 text-gray-dark hover:bg-stone-warm/60',
      )}
    >
      {children}
    </button>
  );
}
