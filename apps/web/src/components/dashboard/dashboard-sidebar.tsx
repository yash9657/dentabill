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
 * Active links use the sage brand surface and pine foreground. Inactive
 * links use muted text, with a visible hover surface and keyboard focus ring.
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
      <p className={cn('text-gray-warm mb-3 px-3 text-xs font-medium', collapsed && 'lg:sr-only')}>
        Workspace
      </p>
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
                  'dashboard-nav-link group flex items-center gap-3 rounded-md px-3 py-2 transition-colors',
                  active
                    ? 'bg-brand-soft text-brand'
                    : 'text-gray-dark hover:bg-warm-stone/60 hover:text-black',
                  collapsed && 'lg:justify-center lg:px-2',
                )}
              >
                <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden />
                <span className={cn('text-caption font-medium', collapsed && 'lg:sr-only')}>
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className={cn('mt-auto px-3 pb-6 pt-10', collapsed && 'lg:hidden')}>
        <p className="text-caption text-brand font-medium">A hand with your follow-ups.</p>
        <p className="text-gray-warm mt-2 text-xs leading-relaxed">
          Have a question? We’re here to help your practice.
        </p>
        <Link
          href="/contact"
          onClick={closeMobileDrawer}
          className="text-brand mt-3 inline-flex text-xs font-medium underline"
        >
          Contact support
        </Link>
      </div>
      <div className="border-border-subtle hidden border-t pt-3 lg:block">
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
