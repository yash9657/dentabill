import type { Metadata } from 'next';
import Link from 'next/link';
import type * as React from 'react';

import { OperationsPage } from '../../../../components/dashboard/settings/operations/operations-page.js';

export const metadata: Metadata = { title: 'Operations · Settings' };

export default function SettingsOperationsPage(): React.ReactElement {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
    return (
      <section>
        <h1 className="text-2xl font-medium">Operations</h1>
        <p className="text-gray-dark mt-3">
          Sign in as an owner or admin to review deliveries and calls that need attention.
        </p>
        <Link
          className="text-brand mt-4 inline-flex min-h-11 items-center underline"
          href="/sign-in"
        >
          Sign in
        </Link>
      </section>
    );
  return <OperationsPage />;
}
