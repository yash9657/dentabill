'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

/**
 * `<DashboardNotifications>` — bell-icon trigger in the topbar.
 *
 * Phase 2 ships the affordance, not the inbox: clicking it opens a
 * native dialog that explains notifications are wired into call
 * outcomes during Phase 3. The button is positioned so the future
 * unread-count badge can drop in without re-laying out the topbar.
 *
 * Same `<dialog>` strategy as the search palette — modal focus,
 * Escape key, and `inert` ancestors for free.
 */
export function DashboardNotifications(): React.ReactElement {
  const dialogRef = React.useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => {
          dialogRef.current?.showModal();
        }}
        className="hover:bg-warm-stone/60 relative inline-flex h-9 w-9 items-center justify-center rounded-md text-black"
      >
        <Bell className="h-4.5 w-4.5" aria-hidden />
      </button>

      <dialog
        ref={dialogRef}
        aria-label="Notifications"
        className="hairline-edge shadow-card rounded-card-large w-full max-w-md bg-white p-6 backdrop:bg-black/30"
      >
        <h2 className="font-body text-body-large mb-2 font-medium text-black">Notifications</h2>
        <p className="text-body text-gray-dark mb-4">
          Your call history has the latest outcomes. A dedicated notification inbox is not available
          yet.
        </p>
        <Link
          href="/dashboard/calls"
          onClick={() => dialogRef.current?.close()}
          className="text-link"
        >
          View call history
        </Link>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => {
              dialogRef.current?.close();
            }}
            className="text-body text-gray-dark hover:bg-warm-stone/60 inline-flex h-9 items-center rounded-md px-3 transition-colors hover:text-black"
          >
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}
