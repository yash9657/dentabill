import type { Metadata } from 'next';
import * as React from 'react';

import { PostingEvidencePage } from '../../../components/dashboard/posting-evidence/posting-evidence-page.js';

export const metadata: Metadata = { title: 'Posting evidence' };

export default function DashboardPostingEvidenceRoute(): React.ReactElement {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
    return (
      <>
        <h1 className="font-body text-[28px] font-semibold leading-[1.15] text-black sm:text-[32px]">
          Posting evidence
        </h1>
        <p className="text-gray-dark mt-3">
          Sign in to import and review PMS posting receipt source observations.
        </p>
      </>
    );
  return <PostingEvidencePage />;
}
