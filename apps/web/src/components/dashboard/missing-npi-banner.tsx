'use client';

import Link from 'next/link';
import * as React from 'react';

import { useMissingNpi } from '../../lib/me/use-me.js';

export function MissingNpiBanner(): React.ReactElement | null {
  const { isMissing, isLoading } = useMissingNpi();
  if (isLoading || !isMissing) return null;

  return (
    <div
      role="status"
      className="hairline-edge rounded-card bg-stone-warm/40 flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-body text-gray-dark">
        <span className="text-black">NPI is missing.</span> Calls to Delta Dental, Cigna, and
        MetLife will fail until you add your 10-digit National Provider Identifier.
      </p>
      <Link
        href="/dashboard/settings/organization?focus=npi"
        className="text-caption hairline-edge rounded-pill duration-standard ease-calm inline-flex h-8 shrink-0 items-center px-3 font-medium text-black transition-colors hover:bg-black hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:ring-offset-1"
      >
        Add NPI in settings →
      </Link>
    </div>
  );
}
