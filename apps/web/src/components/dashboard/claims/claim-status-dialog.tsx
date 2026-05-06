'use client';

import { Button, cn } from '@dentabill/ui';
import * as React from 'react';

import { allowedTransitions, isTerminal } from '../../../lib/claims/state-machine.js';
import { statusLabel, type Claim, type ClaimStatus } from '../../../lib/claims/types.js';
import { useUpdateClaimStatus } from '../../../lib/claims/use-claim.js';

export interface ClaimStatusDialogProps {
  readonly claim: Claim;
}

/**
 * Manual-status-edit dialog for `/dashboard/claims/[id]`.
 *
 * Built on the native `<dialog>` element (same pattern as the
 * dashboard search palette). Native dialogs handle modal focus,
 * the Escape key, and `inert` ancestors out of the box, so we get
 * full keyboard accessibility without a Radix dependency.
 *
 * Behaviour:
 *
 *   - Trigger button is disabled and labelled "(terminal)" when the
 *     claim's status has no outgoing transitions.
 *   - Options are sourced from the client-side mirror of the
 *     server's claim state machine; the server still validates on
 *     submit and surfaces a 409 INVALID_STATE_TRANSITION if it
 *     disagrees (e.g. another biller transitioned the claim first).
 *   - The mutation invalidates the claim list cache on success so
 *     the table on /dashboard/claims reflects the new status when
 *     the user navigates back.
 */
export function ClaimStatusDialog({ claim }: ClaimStatusDialogProps): React.ReactElement {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = React.useState<ClaimStatus | null>(null);
  const mutation = useUpdateClaimStatus(claim.id);
  const options = allowedTransitions(claim.status);
  const terminal = isTerminal(claim.status);

  const open = (): void => {
    setSelected(null);
    mutation.reset();
    dialogRef.current?.showModal();
  };
  const close = (): void => {
    dialogRef.current?.close();
  };

  const submit = async (): Promise<void> => {
    if (!selected) return;
    try {
      await mutation.mutateAsync({ status: selected });
      close();
    } catch {
      // Error surface is rendered inside the dialog from mutation.error.
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="primary"
        onClick={open}
        disabled={terminal}
        aria-disabled={terminal}
        title={terminal ? 'Terminal status — no further transitions allowed.' : undefined}
      >
        Change status
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby="claim-status-dialog-title"
        // Native <dialog> centres via `margin: auto` on the UA stylesheet;
        // Tailwind's preflight zeroes that, so we centre explicitly with
        // a fixed translate. `inset-auto` neutralises Tailwind's `inset-0`
        // bleed on `:modal` so the translate maths stay correct.
        className="hairline-edge rounded-card shadow-card fixed inset-auto left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 bg-white p-6 backdrop:bg-black/40"
      >
        <header className="flex flex-col gap-1">
          <p className="text-caption text-gray-warm uppercase tracking-[0.14em]">
            Manual status change
          </p>
          <h2
            id="claim-status-dialog-title"
            className="font-display text-2xl font-light text-black"
          >
            Move claim {claim.claimNumber}
          </h2>
          <p className="text-body text-gray-dark mt-1 text-sm">
            Currently <strong>{statusLabel(claim.status)}</strong>. Pick the new state. Manual
            changes are audit-logged.
          </p>
        </header>

        <fieldset className="mt-5 flex flex-col gap-2">
          <legend className="sr-only">Available transitions</legend>
          {options.length === 0 ? (
            <p className="text-body text-gray-warm text-sm">
              No transitions available from {statusLabel(claim.status)}.
            </p>
          ) : (
            options.map((option) => {
              const isSelected = selected === option;
              return (
                <label
                  key={option}
                  className={cn(
                    'rounded-card hairline-edge flex cursor-pointer items-center gap-3 px-4 py-3',
                    isSelected ? 'bg-black text-white' : 'hover:bg-stone-warm/40 bg-white',
                  )}
                >
                  <input
                    type="radio"
                    name="claim-status"
                    value={option}
                    checked={isSelected}
                    onChange={() => {
                      setSelected(option);
                    }}
                    className="sr-only"
                  />
                  <span className="text-body text-sm font-medium">{statusLabel(option)}</span>
                </label>
              );
            })
          )}
        </fieldset>

        {mutation.error ? (
          <p role="alert" className="text-body mt-4 text-sm text-black">
            {mutation.error.message}
          </p>
        ) : null}

        <footer className="mt-6 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              void submit();
            }}
            disabled={!selected || mutation.isPending}
          >
            {mutation.isPending ? 'Saving…' : 'Save change'}
          </Button>
        </footer>
      </dialog>
    </>
  );
}
