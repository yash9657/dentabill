import type { Metadata } from 'next';
import * as React from 'react';

import { MarketingPageStub } from '../../../components/marketing/index.js';

export const metadata: Metadata = {
  title: 'Security',
  description:
    'How DentaBill handles PHI, BAAs, and sub-processors. Full statement lands with P2-T21.',
  alternates: { canonical: '/security' },
};

export default function SecurityPage(): React.ReactElement {
  return (
    <MarketingPageStub
      eyebrow="Security"
      heading="The security page is being written."
      body="In the meantime: DOBs are hashed with a per-organisation secret before they leave the dashboard, every database read is org-scoped at the layer below the application, and PHI never reaches our logs. We sign a BAA with every customer. The full sub-processor list and vulnerability disclosure address arrive shortly."
    />
  );
}
