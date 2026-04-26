'use client';

import * as React from 'react';

/**
 * Shared state between `<DashboardShell>` and the sidebar / topbar
 * components rendered into its slots.
 *
 * The desktop collapse state lives here rather than inside the
 * sidebar component itself because the *width* of the shell's
 * `<aside>` element depends on it — pulling it up keeps the
 * layout calculations in one place. The sidebar reads `collapsed`
 * to decide whether to render labels.
 *
 * Mobile drawer state stays internal to the shell: it has no
 * external consumer and surfacing it would force every sidebar
 * link to wire `setDrawerOpen(false)` on click. Instead the shell
 * exposes `closeMobileDrawer()` so links can call a single noop-
 * safe function regardless of breakpoint.
 */
export interface DashboardShellContextValue {
  readonly collapsed: boolean;
  readonly toggleCollapsed: () => void;
  readonly closeMobileDrawer: () => void;
}

const DashboardShellContext = React.createContext<DashboardShellContextValue | null>(null);

export function DashboardShellProvider({
  value,
  children,
}: {
  readonly value: DashboardShellContextValue;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return <DashboardShellContext.Provider value={value}>{children}</DashboardShellContext.Provider>;
}

/**
 * Read the dashboard shell context. Returns sensible no-op defaults
 * when the consumer is rendered outside of a `<DashboardShell>` —
 * useful in unit tests where the component is mounted in isolation.
 */
export function useDashboardShell(): DashboardShellContextValue {
  const ctx = React.useContext(DashboardShellContext);
  if (ctx) return ctx;
  return {
    collapsed: false,
    toggleCollapsed: () => undefined,
    closeMobileDrawer: () => undefined,
  };
}
