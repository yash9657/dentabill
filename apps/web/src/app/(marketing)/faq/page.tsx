import type { Metadata } from 'next';
import * as React from 'react';

import { MarketingPageStub } from '../../../components/marketing/index.js';

export const metadata: Metadata = {
  title: 'FAQ',
  description: 'Common questions about DentaBill. Full FAQ lands with P2-T25.',
  alternates: { canonical: '/faq' },
};

export default function FaqPage(): React.ReactElement {
  return (
    <MarketingPageStub
      eyebrow="FAQ"
      heading="The full FAQ is being written."
      body="The most-asked questions today: which payers do we cover (Delta Dental PPO, Cigna Dental, MetLife Dental at launch, more added on demand), do we sign a BAA (yes, with every customer), and what happens when a payer's IVR changes (the agent escalates to a human queue and we update the IVR map)."
    />
  );
}
