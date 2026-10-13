'use client';

import {
  ArrowRight,
  FileText,
  LayoutDashboard,
  PhoneCall,
  Search,
  Settings,
  TrendingUp,
  Upload,
  X,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

const destinations = [
  {
    label: 'Overview',
    description: 'Your practice at a glance',
    href: '/dashboard/overview',
    icon: LayoutDashboard,
  },
  {
    label: 'Claims',
    description: 'Find and follow up on claims',
    href: '/dashboard/claims',
    icon: FileText,
  },
  {
    label: 'Import claims',
    description: 'Upload a CSV from your practice',
    href: '/dashboard/claims/import',
    icon: Upload,
  },
  {
    label: 'Calls',
    description: 'Live calls and call history',
    href: '/dashboard/calls',
    icon: PhoneCall,
  },
  {
    label: 'Reports',
    description: 'Recovery and payer performance',
    href: '/dashboard/reports',
    icon: TrendingUp,
  },
  {
    label: 'Settings',
    description: 'Manage your practice',
    href: '/dashboard/settings',
    icon: Settings,
  },
] as const;

export function DashboardSearch(): React.ReactElement {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const [search, setSearch] = React.useState('');
  const matches = destinations.filter((item) =>
    `${item.label} ${item.description}`.toLowerCase().includes(search.toLowerCase().trim()),
  );
  const open = React.useCallback(() => {
    setSearch('');
    dialogRef.current?.showModal();
    inputRef.current?.focus();
  }, []);
  const close = (): void => {
    dialogRef.current?.close();
  };
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <>
      <button
        type="button"
        aria-label="Open command palette (Cmd+K)"
        onClick={open}
        className="rounded-standard border-border-light text-gray-warm hover:bg-gray-light inline-flex h-10 w-10 items-center gap-3 border bg-white px-3 sm:w-[210px]"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden />
        <span className="hidden flex-1 text-left text-sm sm:inline">Go to…</span>
        <kbd className="border-border-light hidden rounded border px-1 text-[11px] sm:inline">
          ⌘K
        </kbd>
      </button>
      <dialog
        ref={dialogRef}
        aria-label="Command palette"
        className="rounded-card shadow-warm bg-white p-0"
      >
        <div className="border-border-subtle flex items-center border-b px-5 py-4">
          <h2 className="flex-1 text-sm font-semibold">Search and shortcuts</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="rounded-standard hover:bg-gray-light flex h-9 w-9 items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>
        <input
          ref={inputRef}
          type="search"
          aria-label="Find a page"
          placeholder="Where would you like to go?"
          className="command-input"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              dialogRef.current?.querySelector<HTMLAnchorElement>('a')?.focus();
            }
          }}
        />
        <nav aria-label="Quick navigation" className="p-3">
          {matches.map((item) => (
            <Link key={item.href} href={item.href} onClick={close} className="command-link">
              <item.icon size={18} className="text-gray-warm" />
              <span className="flex-1">
                <strong className="block font-medium">{item.label}</strong>
                <span className="text-gray-warm mt-0.5 block text-xs">{item.description}</span>
              </span>
              <ArrowRight size={15} />
            </Link>
          ))}
          {matches.length === 0 ? (
            <p className="text-gray-dark px-4 py-8 text-sm">
              No pages found. Try “claims”, “calls”, or “settings”.
            </p>
          ) : null}
        </nav>
        <p className="border-border-subtle text-gray-warm border-t px-6 py-3 text-xs">
          Tab to move · Enter to open · Esc to close
        </p>
      </dialog>
    </>
  );
}
