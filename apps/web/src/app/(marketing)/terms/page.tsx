import type { Metadata } from 'next';
import * as React from 'react';

import { LegalDoc } from '../../../components/marketing/index.js';

export const metadata: Metadata = {
  title: 'Terms',
  description:
    'DentaBill terms of service. Template draft, replaced with attorney-reviewed text before public production launch.',
  alternates: { canonical: '/terms' },
};

const EFFECTIVE_DATE = 'April 26, 2026';

/**
 * /terms — terms of service.
 *
 * **This is template language drafted in-house.** It is honest about
 * its own status (the green box at the top says so explicitly), it is
 * not a substitute for attorney-reviewed terms, and per ADR-029 the
 * commitment is to replace it with real terms before public production
 * launch.
 *
 * The structure mirrors the privacy page so a reader who lands on
 * either feels the same shape: eyebrow, title, lede, effective date,
 * long-form prose. The numbered sections are deliberately conservative
 * — they cover the standard SaaS contract surface (account, acceptable
 * use, payment, termination, disclaimer, liability cap, governing law)
 * without trying to be cute.
 */
export default function TermsPage(): React.ReactElement {
  return (
    <LegalDoc
      eyebrow="Terms"
      title="Plain-English terms of service."
      lede="These are the terms you agree to when you use DentaBill. They are written to be readable; they are not yet attorney-reviewed. Before public production launch we replace this draft with reviewed text. If you are in the diligence phase and need a draft for legal review, ask us."
      effective={EFFECTIVE_DATE}
    >
      <p
        className="border-warm-stone bg-warm-stone/30 text-body-small text-gray-dark not-prose -mx-2 mb-6 mt-2 rounded-md border p-4"
        role="note"
      >
        <strong className="text-black">Status:</strong> draft template. Per ADR-029,
        attorney-reviewed terms replace this document before we accept paid customers in production.
        If you need a marked-up version for redline, write to{' '}
        <a
          className="text-black underline underline-offset-2"
          href="mailto:legal@dentabill.example"
        >
          legal@dentabill.example
        </a>
        .
      </p>

      <h2>1. Acceptance</h2>
      <p>
        By creating a DentaBill account or using the service, you agree to these terms and to the{' '}
        <a href="/privacy">Privacy Policy</a>. If you are agreeing on behalf of an organisation, you
        represent that you have authority to bind that organisation. If you do not agree, do not use
        the service.
      </p>

      <h2>2. The service</h2>
      <p>
        DentaBill is an AI voice agent that calls dental insurance payers on your behalf, navigates
        IVRs, talks to claims representatives, and returns structured claim status. The service is
        described in product detail elsewhere on this site.
      </p>
      <p>
        We may update, change, or remove features. We will not remove a feature your billing depends
        on without 30 days&apos; notice and a migration path.
      </p>

      <h2>3. Account terms</h2>
      <p>
        You are responsible for keeping your account credentials confidential and for the activity
        that occurs under your account. Notify us immediately at{' '}
        <a href="mailto:security@dentabill.example">security@dentabill.example</a> if you suspect
        unauthorised access.
      </p>
      <p>
        You may add as many team members from your practice as you want. There is no per-seat fee.
        Pricing is on call volume only, as described on the <a href="/pricing">pricing page</a>.
      </p>

      <h2>4. Acceptable use</h2>
      <p>
        Do not use DentaBill to call payers on behalf of practices you are not authorised to
        represent. Do not use the service to harass, defraud, or otherwise misrepresent yourself to
        a payer. Do not attempt to reverse-engineer the IVR maps, scrape the dashboard, or extract
        customer data that is not yours.
      </p>
      <p>
        We monitor for unusual call patterns and reserve the right to suspend an account that is
        clearly violating these terms while we investigate.
      </p>

      <h2>5. Payment</h2>
      <p>
        Pricing is per call. Starter is free for the first fifty claims a month. Above that, the
        per-call rate applies as published on the pricing page. Invoices are issued monthly, payable
        within 15 days of issue. Past-due accounts are suspended after 30 days; data is retained for
        60 days from suspension before deletion.
      </p>
      <p>
        Pricing changes are notified at least 60 days before they take effect. Existing customers
        keep the prior rate for the duration of any committed period.
      </p>

      <h2>6. Term and termination</h2>
      <p>
        Either party can terminate the agreement at any time. To terminate your account, delete it
        from the Settings page or write to{' '}
        <a href="mailto:legal@dentabill.example">legal@dentabill.example</a>. Termination takes
        effect at the end of the current billing cycle.
      </p>
      <p>
        On termination, we ship an export of your data in CSV the same business day and delete it
        within seven days unless legal hold requires otherwise.
      </p>

      <h2>7. Disclaimer of warranty</h2>
      <p>
        We work hard to make DentaBill reliable. Despite that, the service is provided &quot;as
        is&quot; without warranty of any kind, express or implied. We do not warrant that the
        service will be uninterrupted, error-free, or that every payer call will reach a resolution.
      </p>

      <h2>8. Limitation of liability</h2>
      <p>
        To the extent permitted by law, our total liability for any claim arising out of these terms
        or the service is limited to the fees you paid to DentaBill in the 12 months prior to the
        event giving rise to the claim. We are not liable for indirect, incidental, or consequential
        damages, lost profits, or lost revenue.
      </p>
      <p>
        Nothing in this section limits our obligations under your BAA, including breach
        notification.
      </p>

      <h2>9. Indemnification</h2>
      <p>
        You agree to indemnify DentaBill against claims that arise from your violation of these
        terms or your violation of applicable law in your use of the service.
      </p>

      <h2>10. Governing law</h2>
      <p>
        These terms are governed by the laws of the State of Delaware, United States, without regard
        to conflict-of-laws principles. Disputes are resolved in the state and federal courts
        located in New Castle County, Delaware.
      </p>

      <h2>11. Changes to these terms</h2>
      <p>
        We post material changes here and notify account owners by email at least 30 days before
        they take effect. Continued use of the service after the effective date constitutes
        acceptance.
      </p>

      <h2>12. Contact</h2>
      <p>
        Questions about these terms:{' '}
        <a href="mailto:legal@dentabill.example">legal@dentabill.example</a>. Privacy questions:{' '}
        <a href="mailto:privacy@dentabill.example">privacy@dentabill.example</a>. Security findings:{' '}
        <a href="mailto:security@dentabill.example">security@dentabill.example</a>.
      </p>
    </LegalDoc>
  );
}
