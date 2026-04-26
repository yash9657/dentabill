import type { Metadata } from 'next';
import * as React from 'react';

import { MarketingPageStub } from '../../../components/marketing/index.js';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Talk to the DentaBill team. The full contact form lands with P2-T24.',
  alternates: { canonical: '/contact' },
};

export default function ContactPage(): React.ReactElement {
  return (
    <MarketingPageStub
      eyebrow="Contact"
      heading="The contact form is being wired up."
      body="Until then, the fastest way to reach us is hello@dentabill.example. Tell us how many claims a week your practice follows up on and which payers you work with most, and we will set up a 20-minute call."
    />
  );
}
