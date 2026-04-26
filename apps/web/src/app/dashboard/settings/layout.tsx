import * as React from 'react';

import { SettingsTabs } from '../../../components/dashboard/index.js';

/**
 * Settings nested layout. Renders the section heading + tab strip
 * once and lets each sub-route fill the pane below.
 *
 * The heading is intentionally short ("Settings") because each
 * sub-page already brings its own H1 — duplicating "Settings ›
 * Organization" would just push the actual content down a row.
 */
export default function DashboardSettingsLayout({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <header className="mb-2">
        <p className="text-caption text-gray-warm uppercase tracking-[0.14em]">Settings</p>
      </header>
      <SettingsTabs />
      {children}
    </div>
  );
}
