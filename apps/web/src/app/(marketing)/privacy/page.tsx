import type { Metadata } from 'next';
import * as React from 'react';

import { MarketingPageStub } from '../../../components/marketing/index.js';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'DentaBill privacy policy. Full text lands with P2-T22.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage(): React.ReactElement {
  return (
    <MarketingPageStub
      eyebrow="Privacy"
      heading="Our privacy policy is being finalised."
      body="The short version: we collect the minimum information needed to call payers on your behalf, we never sell or share patient data, and PHI is redacted from logs by the runtime before it ever leaves the application. The long version, with sub-processor list and retention timelines, arrives in the proper privacy page."
    />
  );
}
