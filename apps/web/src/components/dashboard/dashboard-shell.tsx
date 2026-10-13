'use client';

import { BrandMark, cn } from '@dentabill/ui';
import { Menu, X } from 'lucide-react';
import * as React from 'react';

import { DashboardShellProvider } from './dashboard-shell-context.js';

/** Shared responsive navigation, focus management, and persisted desktop collapse state. */
const SIDEBAR_ID = 'dashboard-sidebar';
const COLLAPSE_STORAGE_KEY = 'dentabill:dashboard:sidebar-collapsed';

export interface DashboardShellProps {
  readonly sidebar: React.ReactNode;
  readonly topbar: React.ReactNode;
  readonly children: React.ReactNode;
}

export function DashboardShell({
  sidebar,
  topbar,
  children,
}: DashboardShellProps): React.ReactElement {
  const sidebarRef = React.useRef<HTMLElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLButtonElement>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (stored === '1') setCollapsed(true);
    } catch {
      // Private browsing or storage disabled — fall back to expanded.
    }
  }, []);

  React.useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const sync = (): void => {
      if (sidebarRef.current) sidebarRef.current.inert = !media.matches && !drawerOpen;
      if (media.matches && drawerOpen) setDrawerOpen(false);
    };
    sync();
    media.addEventListener('change', sync);
    return () => {
      media.removeEventListener('change', sync);
    };
  }, [drawerOpen]);

  React.useEffect(() => {
    if (!drawerOpen) return;
    const content = contentRef.current;
    const menu = menuRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (content) content.inert = true;
    const focusable = (): HTMLElement[] =>
      Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)') ?? [],
      ).filter((element) => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDrawerOpen(false);
      if (event.key === 'Tab') {
        const elements = focusable();
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (content) content.inert = false;
      window.removeEventListener('keydown', onKey);
      menu?.focus();
    };
  }, [drawerOpen]);

  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Storage may be disabled; the in-memory state is still authoritative.
      }
      return next;
    });
  }, []);

  const closeMobileDrawer = React.useCallback(() => {
    setDrawerOpen(false);
  }, []);

  const ctx = React.useMemo(
    () => ({ collapsed, toggleCollapsed, closeMobileDrawer }),
    [collapsed, toggleCollapsed, closeMobileDrawer],
  );

  return (
    <DashboardShellProvider value={ctx}>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <div className="dashboard-shell flex min-h-screen flex-col lg:flex-row">
        <aside
          ref={sidebarRef}
          id={SIDEBAR_ID}
          aria-label="Dashboard navigation"
          data-collapsed={collapsed ? 'true' : 'false'}
          className={cn(
            'dashboard-sidebar border-border-light fixed inset-y-0 left-0 z-50 flex w-[240px] -translate-x-full flex-col border-r transition-[transform,width] duration-200 ease-out',
            'lg:sticky lg:inset-y-auto lg:top-0 lg:h-screen lg:translate-x-0 lg:self-start',
            drawerOpen && 'translate-x-0',
            collapsed && 'lg:w-[72px]',
          )}
        >
          <div className="border-border-subtle flex h-[76px] items-center justify-between border-b px-5">
            <div
              className={cn(
                'font-body text-brand inline-flex items-center gap-2 text-[22px] font-semibold tracking-[-0.03em]',
                collapsed && 'lg:hidden',
              )}
            >
              <BrandMark size={32} />
              <span>DentaBill</span>
            </div>
            <div
              aria-hidden
              className={cn(
                'hidden text-black',
                collapsed ? 'lg:inline-flex lg:w-full lg:items-center lg:justify-center' : '',
              )}
            >
              {collapsed ? <BrandMark size={22} /> : null}
            </div>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => {
                setDrawerOpen(false);
              }}
              className="hover:bg-warm-stone/60 inline-flex h-9 w-9 items-center justify-center rounded-md text-black lg:hidden"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className={cn('flex-1 overflow-y-auto py-4', collapsed ? 'px-3 lg:px-2' : 'px-3')}>
            {sidebar}
          </div>
        </aside>

        {drawerOpen ? (
          <button
            type="button"
            aria-label="Dismiss menu"
            onClick={() => {
              setDrawerOpen(false);
            }}
            className="fixed inset-0 z-40 bg-black/30 lg:hidden"
          />
        ) : null}

        <div ref={contentRef} className="flex min-w-0 flex-1 flex-col">
          <header
            role="banner"
            className="border-border-subtle sticky top-0 z-30 flex h-[76px] shrink-0 items-center gap-3 border-b bg-white px-4 sm:px-6"
          >
            <button
              type="button"
              ref={menuRef}
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              aria-controls={SIDEBAR_ID}
              onClick={() => {
                setDrawerOpen(true);
              }}
              className="hover:bg-warm-stone/60 inline-flex h-10 w-10 items-center justify-center rounded-md text-black lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">{topbar}</div>
          </header>

          <main id="main-content" className="min-w-0 flex-1">
            {children}
          </main>
        </div>
      </div>
    </DashboardShellProvider>
  );
}
