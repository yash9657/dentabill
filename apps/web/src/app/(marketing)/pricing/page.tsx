import type { Metadata } from 'next';
import * as React from 'react';

import { MarketingPageStub } from '../../../components/marketing/index.js';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'DentaBill pricing — Starter / Professional / Enterprise plans. Final tiers and the FAQ land with P2-T20.',
  alternates: { canonical: '/pricing' },
};

export default function PricingPage(): React.ReactElement {
  return (
    <MarketingPageStub
      eyebrow="Pricing"
      heading="We are putting the pricing page together."
      body="Three tiers — Starter for solo practices, Professional for multi-location, Enterprise for DSOs — with a real cost calculator. Until that lands, the simplest answer is: free for the first fifty claims, then a per-call fee that pays for itself the first time we save your front desk an hour."
    />
  );
}
