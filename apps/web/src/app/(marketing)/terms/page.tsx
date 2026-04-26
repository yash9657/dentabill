import type { Metadata } from 'next';
import * as React from 'react';

import { MarketingPageStub } from '../../../components/marketing/index.js';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'DentaBill terms of service. Final language lands with P2-T23.',
  alternates: { canonical: '/terms' },
};

export default function TermsPage(): React.ReactElement {
  return (
    <MarketingPageStub
      eyebrow="Terms"
      heading="The terms of service are being drafted."
      body="If you are evaluating DentaBill for a practice and need draft terms or a BAA template before the published version is ready, write to us and we will send the current copy. We will not surprise anyone with billing changes or fine print."
    />
  );
}
