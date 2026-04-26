import * as React from 'react';

import { DashboardAccountControls } from './dashboard-account-controls.js';
import { DashboardNotifications } from './dashboard-notifications.js';
import { DashboardSearch } from './dashboard-search.js';

/**
 * `<DashboardTopbar>` — the right-aligned controls inside the
 * shell's 64px topbar slot.
 *
 * Composition order, left to right (after the spacer): search +
 * cmd+k trigger, vertical hairline divider, notifications bell,
 * org switcher, user button. The leftmost slot stays empty — the
 * mobile hamburger lives in the shell, and a wide topbar
 * intentionally does not fight the sidebar's wordmark for
 * attention.
 *
 * All three interactive children are client components; this
 * wrapper stays a server component so the layout itself doesn't
 * pay the hydration cost of the topbar shell.
 */
export function DashboardTopbar(): React.ReactElement {
  return (
    <div className="flex items-center justify-end gap-2">
      <DashboardSearch />
      <DashboardNotifications />
      <span aria-hidden className="bg-black/8 mx-1 hidden h-6 w-px sm:inline-block" />
      <DashboardAccountControls />
    </div>
  );
}
