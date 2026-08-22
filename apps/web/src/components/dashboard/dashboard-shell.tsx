'use client';

import { BrandMark, cn } from '@dentabill/ui';
import { Menu, X } from 'lucide-react';
import * as React from 'react';

import { DashboardShellProvider } from './dashboard-shell-context.js';

/**
 * `<DashboardShell>` — the visual chassis for every authenticated
 * `/dashboard/**` route.
 *
 * Layout primitives (DESIGN.md, ADR-013, sized to ElevenLabs's own
 * dashboard treatment):
 *
 *   • Sidebar: 240px wide expanded / 72px collapsed, white, hairline
 *     right border. On large viewports (>=lg) it is a permanently-
 *     visible flex column whose width tracks the persisted collapse
 *     preference (see below). On small viewports it is a fixed
 *     drawer that slides in from the left, behind a translucent
 *     scrim that dismisses the drawer when clicked.
 *   • Topbar: 64px tall, white, hairline bottom border. Hosts the
 *     mobile hamburger trigger and the topbar slot (filled by
 *     P2-T34 with the org switcher / user button / search).
 *   • Content well: takes the rest. Grid-positioned so the topbar
 *     is sticky-friendly and the sidebar shadow does not clip when
 *     the page scrolls.
 *
 * Why a single client component owning the state instead of three
 * siblings: both the desktop collapse preference and the mobile
 * drawer mechanics need to coordinate the sidebar's width and
 * visibility. Lifting that to one place keeps the props minimal,
 * and the collapse state is exposed to children via
 * `<DashboardShellContext>` so the sidebar can hide labels in sync
 * with the width animation.
 *
 * Persistence: the desktop collapse preference is mirrored to
 * `localStorage` under `dentabill:dashboard:sidebar-collapsed`. We
 * read it lazily after hydration to keep the SSR markup stable
 * (the server has no access to localStorage); a brief "expanded"
 * flicker on first paint is preferable to a hydration mismatch
 * crash, and the animation hides the transition.
 */
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
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
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
      <div className="flex min-h-screen flex-col bg-white lg:flex-row">
        <aside
          id={SIDEBAR_ID}
          aria-label="Dashboard navigation"
          data-collapsed={collapsed ? 'true' : 'false'}
          className={cn(
            'border-border-subtle fixed inset-y-0 left-0 z-50 flex w-[240px] -translate-x-full flex-col border-r bg-white transition-[transform,width] duration-200 ease-out',
            'lg:sticky lg:inset-y-auto lg:top-0 lg:h-screen lg:translate-x-0 lg:self-start',
            drawerOpen && 'translate-x-0',
            collapsed && 'lg:w-[72px]',
          )}
        >
          <div className="border-border-subtle flex h-16 items-center justify-between border-b px-5">
            <div
              className={cn(
                'font-display inline-flex items-center gap-2 text-[18px] font-light tracking-[-0.01em] text-black',
                collapsed && 'lg:hidden',
              )}
            >
              <BrandMark size={28} />
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
              className="hover:bg-stone-warm/60 inline-flex h-9 w-9 items-center justify-center rounded-md text-black lg:hidden"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className={cn('flex-1 overflow-y-auto py-4', collapsed ? 'lg:px-2' : 'px-3')}>
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

        <div className="flex min-w-0 flex-1 flex-col">
          <header
            role="banner"
            className="border-border-subtle sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b bg-white px-4 sm:px-6"
          >
            <button
              type="button"
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              aria-controls={SIDEBAR_ID}
              onClick={() => {
                setDrawerOpen(true);
              }}
              className="hover:bg-stone-warm/60 inline-flex h-10 w-10 items-center justify-center rounded-md text-black lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">{topbar}</div>
          </header>

          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </DashboardShellProvider>
  );
}
