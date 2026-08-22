'use client';

import { cn } from '@dentabill/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

/**
 * `<SettingsTabs>` — horizontal sub-navigation rendered above every
 * /dashboard/settings/* page. Six destinations matching the Phase 2
 * Settings surface: Organization, Team, Billing, Integrations,
 * Notifications, Audit log.
 *
 * Active state is derived the same way the sidebar does it
 * (pathname equals or nests under the link href). Styling stays
 * achromatic per ADR-013: the active tab gets a black underline +
 * `text-black`, inactive tabs are `text-gray-warm` with hover bringing
 * them up to `text-black`.
 *
 * Below `md` the row reflows into a horizontal scroll container so
 * narrow viewports show all six tabs without truncating any of
 * them. ARIA: rendered as a `<nav aria-label="Settings sections">`
 * over a plain `<ul>`; tabs are real `<a>` links rather than ARIA
 * tabs, because each pane is its own route — the back/forward
 * button must work, and a tablist would lie about that.
 */
export const SETTINGS_TABS: readonly { readonly href: string; readonly label: string }[] = [
  { href: '/dashboard/settings/organization', label: 'Organization' },
  { href: '/dashboard/settings/team', label: 'Team' },
  { href: '/dashboard/settings/usage', label: 'Usage' },
  { href: '/dashboard/settings/integrations', label: 'Integrations' },
  { href: '/dashboard/settings/notifications', label: 'Notifications' },
  { href: '/dashboard/settings/audit-log', label: 'Audit log' },
];

function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}

export function SettingsTabs(): React.ReactElement {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Settings sections"
      className="border-border-subtle -mx-4 mb-8 border-b sm:-mx-6 lg:-mx-8"
    >
      <ul className="flex gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8">
        {SETTINGS_TABS.map(({ href, label }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'text-body inline-flex items-center border-b-2 px-3 py-3 font-medium transition-colors',
                  active
                    ? 'border-black text-black'
                    : 'text-gray-warm border-transparent hover:text-black',
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
