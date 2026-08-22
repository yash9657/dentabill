'use client';

import { cn } from '@dentabill/ui';
import {
  ChevronsLeft,
  ChevronsRight,
  FileText,
  LayoutDashboard,
  PhoneCall,
  Settings,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { useDashboardShell } from './dashboard-shell-context.js';

/**
 * `<DashboardSidebar>` — the real navigation list rendered into the
 * shell's sidebar slot.
 *
 * Five top-level destinations match the Phase 2 product surface:
 * Overview, Claims, Calls, Reports, Settings. Active state is
 * derived from `usePathname()`: the current pathname matches the
 * link if it equals the link href OR starts with `${link.href}/`,
 * so `/dashboard/claims/abc123` lights up "Claims" without a
 * separate active-detection rule per page.
 *
 * Two visual modes, both reachable from the same component:
 *
 *   • Expanded (default) — icon + label, full 240px sidebar.
 *   • Collapsed — icon-only, 72px sidebar. The collapse toggle
 *     below the link list flips the shell-level `collapsed` flag,
 *     which `<DashboardShell>` mirrors to localStorage.
 *
 * Active state styling is achromatic per ADR-013: the active link
 * gets a `bg-stone-warm/60` background and `text-black`; inactive
 * links use `text-gray-dark` and the same warm-stone background on
 * hover. No chromatic accent — the dashboard uses the teal accent
 * only for live-call indicators (`<StatusDot variant="active">`),
 * never as a navigation cue.
 */
export const DASHBOARD_NAV_LINKS: readonly {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
}[] = [
  { href: '/dashboard/overview', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/claims', label: 'Claims', icon: FileText },
  { href: '/dashboard/calls', label: 'Calls', icon: PhoneCall },
  { href: '/dashboard/reports', label: 'Reports', icon: TrendingUp },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}

export function DashboardSidebar(): React.ReactElement {
  const pathname = usePathname();
  const { collapsed, toggleCollapsed, closeMobileDrawer } = useDashboardShell();

  return (
    <nav aria-label="Sidebar" className="flex h-full flex-col">
      <ul className="flex flex-col gap-1">
        {DASHBOARD_NAV_LINKS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={closeMobileDrawer}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group flex items-center gap-3 rounded-md px-3 py-2 transition-colors',
                  active
                    ? 'bg-warm-stone/80 text-black'
                    : 'text-gray-dark hover:bg-warm-stone/60 hover:text-black',
                  collapsed && 'lg:justify-center lg:px-2',
                )}
              >
                <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden />
                <span className={cn('text-body font-medium', collapsed && 'lg:sr-only')}>
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="border-border-subtle mt-auto hidden border-t pt-3 lg:block">
        <button
          type="button"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
          onClick={toggleCollapsed}
          className={cn(
            'text-gray-warm hover:bg-warm-stone/60 flex w-full items-center gap-3 rounded-md px-3 py-2 transition-colors hover:text-black',
            collapsed && 'justify-center px-2',
          )}
        >
          {collapsed ? (
            <ChevronsRight className="h-4.5 w-4.5 shrink-0" aria-hidden />
          ) : (
            <ChevronsLeft className="h-4.5 w-4.5 shrink-0" aria-hidden />
          )}
          <span className={cn('text-caption', collapsed && 'sr-only')}>Collapse</span>
        </button>
      </div>
    </nav>
  );
}
