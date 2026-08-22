'use client';

import { Search } from 'lucide-react';
import * as React from 'react';

/**
 * `<DashboardSearch>` — the search trigger and command-palette stub
 * for the dashboard topbar.
 *
 * Phase 2 ships the trigger + the cmd+k keyboard binding; the
 * palette itself is a deliberately empty dialog that explains the
 * full feature is on its way. The shape (trigger button + dialog)
 * is in place so when actions land (cmd+k → "Go to claim by ID",
 * "Switch org", "Open settings") the wiring is just adding rows
 * to a list, not introducing a new pattern.
 *
 * The dialog uses the native `<dialog>` element and its `showModal()`
 * / `close()` methods. Native dialogs handle modal focus, the
 * Escape key, and `inert` ancestors for free, so we get full
 * keyboard accessibility without a Radix dependency. The trigger
 * is a `<button>` styled to look like a search field — clear
 * affordance, no fake-input-element a11y trap.
 */
const SHORTCUT_KEY = 'k';

export function DashboardSearch(): React.ReactElement {
  const dialogRef = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const isCommand = e.metaKey || e.ctrlKey;
      if (isCommand && e.key.toLowerCase() === SHORTCUT_KEY) {
        e.preventDefault();
        dialogRef.current?.showModal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const open = (): void => {
    dialogRef.current?.showModal();
  };
  const close = (): void => {
    dialogRef.current?.close();
  };

  return (
    <>
      <button
        type="button"
        aria-label="Open command palette (Cmd+K)"
        onClick={open}
        className="text-gray-warm hover:bg-warm-stone/60 hairline-edge hidden h-9 min-w-[180px] items-center gap-2 rounded-md bg-white px-3 transition-colors hover:text-black sm:inline-flex"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden />
        <span className="text-caption flex-1 text-left">Search</span>
        <kbd className="text-caption text-gray-warm border-border-subtle hidden rounded border px-1.5 py-0.5 font-sans md:inline">
          ⌘K
        </kbd>
      </button>
      <button
        type="button"
        aria-label="Open command palette (Cmd+K)"
        onClick={open}
        className="hover:bg-warm-stone/60 inline-flex h-9 w-9 items-center justify-center rounded-md text-black sm:hidden"
      >
        <Search className="h-4 w-4" aria-hidden />
      </button>

      <dialog
        ref={dialogRef}
        aria-label="Command palette"
        className="hairline-edge shadow-card rounded-card-large w-full max-w-lg bg-white p-6 backdrop:bg-black/30"
      >
        <h2 className="font-display text-body-large mb-2 font-light text-black">
          Search and shortcuts
        </h2>
        <p className="text-body text-gray-dark mb-4">
          A working command palette is coming soon. The keyboard binding (⌘K) is already live so
          muscle memory works the moment actions are wired up.
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={close}
            className="text-body text-gray-dark hover:bg-warm-stone/60 inline-flex h-9 items-center rounded-md px-3 transition-colors hover:text-black"
          >
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}
