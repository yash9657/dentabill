import * as React from 'react';

/**
 * Placeholder topbar contents. The real org switcher / search /
 * notifications / user menu compose in P2-T34. This stub keeps the
 * topbar visually balanced during T32 visual review.
 *
 * The flex spacer + a quiet label is enough to preview the 64px
 * height; nothing here ships beyond T34.
 */
export function DashboardTopbarPlaceholder(): React.ReactElement {
  return (
    <div className="flex items-center justify-end gap-3">
      <span className="text-caption text-gray-warm hidden sm:inline">
        Workspace controls arrive with P2-T34
      </span>
    </div>
  );
}
