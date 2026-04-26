import type { Metadata } from 'next';
import * as React from 'react';

import { MarketingPageStub } from '../../../components/marketing/index.js';

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Notes from the DentaBill team. The blog lands with P2-T26.',
  alternates: { canonical: '/blog' },
};

export default function BlogPage(): React.ReactElement {
  return (
    <MarketingPageStub
      eyebrow="Blog"
      heading="No posts yet."
      body="When we have something useful to say about dental billing automation, payer IVR drift, or the engineering choices behind DentaBill, it will appear here. We would rather publish nothing than publish filler."
    />
  );
}
