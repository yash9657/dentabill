import type { Metadata } from 'next';
import * as React from 'react';

import {
  DashboardBreadcrumbs,
  DashboardShell,
  DashboardSidebarPlaceholder,
  DashboardTopbarPlaceholder,
} from '../../components/dashboard/index.js';

/**
 * Dashboard layout — wraps every `/dashboard/**` route with the
 * authenticated shell (240px sidebar, 64px topbar, content area
 * with breadcrumbs, mobile drawer below `lg`).
 *
 * Lives at `/dashboard/layout.tsx` rather than under a `(dashboard)`
 * route group: every authenticated page already lives under
 * `/dashboard`, the middleware's `createRouteMatcher(['/dashboard(.*)'])`
 * gate keys off the same prefix, and a route group would only add a
 * level of indirection without buying anything. The marketing layout
 * does need a route group because its routes (`/`, `/about`, etc.)
 * share no common prefix; the dashboard does not.
 *
 * The shell composes three slots: the sidebar (P2-T33 fills with
 * real nav), the topbar (P2-T34 fills with the org switcher / user
 * button / search), and the children pane that renders the page.
 * Breadcrumbs render at the top of the children pane in the page
 * itself rather than the layout, so each page can pass route-
 * specific labels (resolved cuids, etc.) when its content loads.
 */
export const metadata: Metadata = {
  title: { default: 'Dashboard', template: '%s · DentaBill' },
  robots: { index: false, follow: false },
};

export default function DashboardLayout({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <DashboardShell
      sidebar={<DashboardSidebarPlaceholder />}
      topbar={<DashboardTopbarPlaceholder />}
    >
      <div className="px-4 pb-12 pt-6 sm:px-6 lg:px-8">
        <DashboardBreadcrumbs />
        <div className="mt-4">{children}</div>
      </div>
    </DashboardShell>
  );
}
