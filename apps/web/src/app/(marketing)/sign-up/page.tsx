import type { Metadata } from 'next';
import * as React from 'react';

import { MarketingPageStub } from '../../../components/marketing/index.js';

export const metadata: Metadata = {
  title: 'Sign up',
  description: 'Create a DentaBill account. Full Clerk sign-up lands with P2-T29.',
  alternates: { canonical: '/sign-up' },
  robots: { index: false, follow: true },
};

export default function SignUpPage(): React.ReactElement {
  return (
    <MarketingPageStub
      eyebrow="Sign up"
      heading="Account creation is almost ready."
      body="Sign-up runs through Clerk and lands with the auth wiring in P2-T29. If you would like an invite the day it ships, drop a line at hello@dentabill.example."
    />
  );
}
