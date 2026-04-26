'use client';

import { OrganizationSwitcher, UserButton } from '@clerk/nextjs';
import { Building2, User } from 'lucide-react';
import * as React from 'react';

/**
 * `<DashboardAccountControls>` — the org switcher and user button
 * pair, with a graceful fallback when Clerk keys are not present.
 *
 * Same conditional-render gate the rest of the codebase uses. When
 * NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is set, Clerk's hosted
 * components render and pick up theming from the
 * `<ClerkProvider appearance={...}>` in providers.tsx. When it is
 * unset (dev / CI), the static fallback shows a placeholder org
 * pill and a generic user-icon button so the topbar layout stays
 * stable.
 *
 * Kept as a single component because the org switcher and user
 * button always travel together — even the Clerk docs show them
 * adjacent. Splitting them would force every consumer to compose
 * the same two-component fragment.
 */
const HAS_CLERK_KEYS = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function DashboardAccountControls(): React.ReactElement {
  if (HAS_CLERK_KEYS) {
    return (
      <>
        <OrganizationSwitcher
          hidePersonal
          appearance={{
            elements: {
              rootBox: 'flex items-center',
              organizationSwitcherTrigger:
                'rounded-md px-2 py-1.5 hover:bg-stone-warm/60 text-body text-black',
            },
          }}
        />
        <UserButton
          appearance={{
            elements: {
              avatarBox: 'h-8 w-8',
            },
          }}
        />
      </>
    );
  }
  return (
    <>
      <div
        role="group"
        aria-label="Demo workspace"
        className="text-body text-gray-dark hairline-edge bg-stone-warm/40 hidden h-9 items-center gap-2 rounded-md px-3 sm:inline-flex"
      >
        <Building2 className="h-4 w-4 shrink-0" aria-hidden />
        <span className="font-medium text-black">Demo workspace</span>
      </div>
      <div
        role="img"
        aria-label="Account placeholder"
        className="bg-stone-warm/60 inline-flex h-8 w-8 items-center justify-center rounded-full text-black"
      >
        <User className="h-4 w-4" aria-hidden />
      </div>
    </>
  );
}
