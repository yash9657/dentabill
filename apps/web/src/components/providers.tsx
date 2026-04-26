'use client';

import { QueryProvider } from '@dentabill/ui/query';
import * as React from 'react';

/**
 * Single client-side provider tree mounted by the root RSC layout.
 *
 * Centralising providers here keeps `app/layout.tsx` an async Server
 * Component (so it can read request-scoped state like the request id)
 * while still letting us nest client-only contexts like TanStack Query.
 * Future providers (Clerk in P2-T28, theme toggling, etc.) wrap inside
 * this same component so the layout itself never grows new `'use client'`
 * boundaries.
 */
export function Providers({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return <QueryProvider>{children}</QueryProvider>;
}
