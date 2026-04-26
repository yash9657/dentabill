import type { Metadata } from 'next';
import * as React from 'react';

import { MarketingPageStub } from '../../../components/marketing/index.js';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to DentaBill. Full Clerk sign-in lands with P2-T29.',
  alternates: { canonical: '/sign-in' },
  robots: { index: false, follow: true },
};

export default function SignInPage(): React.ReactElement {
  return (
    <MarketingPageStub
      eyebrow="Sign in"
      heading="Sign in is almost ready."
      body="Auth runs through Clerk and lands with P2-T29. If you have an existing account waiting on access, write to hello@dentabill.example and we will turn it on."
    />
  );
}
