import * as React from 'react';

/**
 * Placeholder sidebar body. The real navigation list (Overview, Claims,
 * Calls, Reports, Settings) lands with P2-T33; until then the sidebar
 * renders this stub so the dashboard shell has something to align
 * against during T32 visual review.
 *
 * Only used in this single transitional task — the file disappears
 * the moment T33 ships its real `<DashboardSidebar>` component.
 */
export function DashboardSidebarPlaceholder(): React.ReactElement {
  return (
    <div className="text-caption text-gray-warm px-3 py-2">Navigation arrives with P2-T33.</div>
  );
}
