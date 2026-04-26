'use client';

import { cn } from '@dentabill/ui';
import { Menu, X } from 'lucide-react';
import * as React from 'react';

/**
 * `<DashboardShell>` — the visual chassis for every authenticated
 * `/dashboard/**` route.
 *
 * Layout primitives (DESIGN.md, ADR-013, sized to ElevenLabs's own
 * dashboard treatment):
 *
 *   • Sidebar: 240px wide, white, hairline right border. On large
 *     viewports (>=lg) it's a permanently-visible flex column. On
 *     small viewports it's a fixed-position drawer that slides in
 *     from the left when toggled, behind a translucent scrim that
 *     dismisses the drawer when clicked.
 *   • Topbar: 64px tall, white, hairline bottom border. Hosts the
 *     mobile hamburger trigger on small viewports, and is a slot for
 *     the org switcher / user button / search command palette
 *     (filled in by P2-T34).
 *   • Content well: takes the rest. Grid-positioned so the topbar
 *     is sticky-friendly and the sidebar shadow does not clip when
 *     the page scrolls.
 *
 * Why a single client component instead of three siblings:
 * the mobile-drawer state is shared between the topbar's hamburger
 * trigger and the sidebar visibility. Lifting state to a parent
 * component keeps the props-passing minimal and avoids a Context
 * we'd only use in one place.
 *
 * State persistence: the desktop sidebar is always visible (no
 * collapse toggle in T32 — that lives on a future iteration when
 * the link list grows). The mobile drawer auto-closes on every
 * route change (Next's segment-level route change fires the
 * `pathname` effect inside the consumer of `usePathname`); we wire
 * that here via a parent-supplied `onNavigate` not yet — for now
 * the drawer simply closes when the scrim is clicked or `Escape`
 * is pressed.
 */
export interface DashboardShellProps {
  readonly sidebar: React.ReactNode;
  readonly topbar: React.ReactNode;
  readonly children: React.ReactNode;
}

const SIDEBAR_ID = 'dashboard-sidebar';

export function DashboardShell({
  sidebar,
  topbar,
  children,
}: DashboardShellProps): React.ReactElement {
  const [drawerOpen, setDrawerOpen] = React.useState(false);

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

  return (
    <div className="bg-stone-warm/30 flex min-h-screen flex-col lg:flex-row">
      <aside
        id={SIDEBAR_ID}
        aria-label="Dashboard navigation"
        className={cn(
          'border-black/6 fixed inset-y-0 left-0 z-50 flex w-[240px] -translate-x-full flex-col border-r bg-white transition-transform duration-200 ease-out',
          'lg:relative lg:translate-x-0',
          drawerOpen && 'translate-x-0',
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-black/5 px-5">
          <div className="font-display text-[18px] font-light tracking-[-0.01em] text-black">
            DentaBill
          </div>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => {
              setDrawerOpen(false);
            }}
            className="hover:bg-stone-warm/60 inline-flex h-9 w-9 items-center justify-center rounded-md text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">{sidebar}</div>
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
          className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-black/5 bg-white px-4 sm:px-6"
        >
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            aria-controls={SIDEBAR_ID}
            onClick={() => {
              setDrawerOpen(true);
            }}
            className="hover:bg-stone-warm/60 inline-flex h-10 w-10 items-center justify-center rounded-md text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">{topbar}</div>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
