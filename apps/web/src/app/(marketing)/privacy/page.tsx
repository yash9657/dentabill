import type { Metadata } from 'next';
import * as React from 'react';

import { LegalDoc } from '../../../components/marketing/index.js';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'DentaBill privacy policy. We collect the minimum information needed to call payers on your behalf, never sell or share patient data, and redact PHI from logs at the runtime layer.',
  alternates: { canonical: '/privacy' },
};

const EFFECTIVE_DATE = 'April 26, 2026';

/**
 * /privacy — privacy policy.
 *
 * Written to be read end-to-end in under five minutes. We avoid the
 * "we may collect, we may use, we may share" hedging language that
 * makes most privacy pages indistinguishable; concrete verbs ("we
 * collect", "we use") are clearer for a reader trying to make a
 * vendor decision.
 *
 * The PHI-specific paragraph is the most-load-bearing part of this
 * page; it links back to /security for the technical how. Sections
 * deliberately re-order so what matters most for our specific
 * customer (PHI handling, not cookies) leads.
 */
export default function PrivacyPage(): React.ReactElement {
  return (
    <LegalDoc
      eyebrow="Privacy"
      title="A short, honest privacy policy."
      lede="DentaBill collects the minimum information needed to call insurance payers on your behalf. We do not sell or share patient data. PHI is redacted from our logs by the runtime, before any application code can see it."
      effective={EFFECTIVE_DATE}
    >
      <h2>Information we collect</h2>
      <p>We collect three categories of information:</p>
      <ul>
        <li>
          <strong>Account information.</strong> Your name, work email, organisation name, and the
          payers you work with most often. Provided by you when you sign up or update your settings,
          or by Clerk during authentication.
        </li>
        <li>
          <strong>Claim information.</strong> The claims you upload via CSV. We hash patient dates
          of birth with a per-organisation secret before they leave your dashboard, so the DOB never
          touches our database in plain text. Member IDs are encrypted at rest.
        </li>
        <li>
          <strong>Operational information.</strong> Call recordings, transcripts, and structured
          summaries the agent produces. Recordings are encrypted at rest with AES-256 and
          access-logged.
        </li>
      </ul>
      <p>
        We also collect the usual technical data a web application gathers from a browser: IP
        address, user agent, and the actions you take inside the dashboard. We use it for debugging,
        fraud prevention, and product analytics. PHI never appears in this stream.
      </p>

      <h2>How we use information</h2>
      <p>
        We use account and claim information to do the work you hired us to do: call payers,
        navigate IVRs, talk to claims reps, and return structured status. We use operational
        information to improve the agent and to give you an audit trail.
      </p>
      <p>
        We do not sell information. We do not share it with advertisers. We do not use claim
        information to train general-purpose models. We do use Anthropic and Retell AI as{' '}
        <a href="/security">sub-processors</a>; both are bound by data processing terms that
        restrict use to the immediate task.
      </p>

      <h2>PHI specifically</h2>
      <p>
        Patient names, dates of birth, member IDs, and Social Security numbers are{' '}
        <strong>protected health information</strong> under HIPAA. We treat them accordingly:
      </p>
      <ul>
        <li>
          The <code className="font-mono text-[0.95em] text-black">@dentabill/logger</code> package
          redacts PHI before any log line leaves the runtime. An application engineer who forgets
          cannot leak PHI through a stray log statement.
        </li>
        <li>
          Patient DOBs are hashed with a per-organisation secret. We use the hash for IVR identity
          verification with the payer; we cannot reverse it.
        </li>
        <li>
          Every database read is org-scoped at a layer below the application. Cross-tenant access is
          a build-time error, not a code review heuristic.
        </li>
        <li>
          Call recordings containing PHI are encrypted at rest, retained for the period your BAA
          specifies, and purgeable on request within seven days.
        </li>
      </ul>
      <p>
        For the technical detail, see <a href="/security">the security page</a>.
      </p>

      <h2>Sharing and disclosure</h2>
      <p>
        We share information only with sub-processors that are necessary to operate the service. The
        current list is published on <a href="/security">the security page</a>; we update it at
        least 30 days before adding a sub-processor that handles production data.
      </p>
      <p>
        We will disclose information when legally required (subpoena, court order, regulatory
        request). We will notify you of any such request unless legally prohibited from doing so.
      </p>

      <h2>Cookies</h2>
      <p>
        We use a small number of cookies to keep you signed in (Clerk session) and to measure how
        marketing pages perform. We do not use third-party advertising trackers. The notice banner
        on the site is a notice, not a consent gate; if and when we add cookies that require
        consent, we will gate them behind an explicit opt-in.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        Account information is retained for the life of your DentaBill account. Claim information is
        retained per your BAA, typically six years. Call recordings are retained per your BAA,
        typically two years.
      </p>
      <p>
        You can delete an organisation, including all of its claim and call data, from the Settings
        page in the dashboard. Deletion is hard delete, not soft delete: the rows are removed from
        the primary database, and recordings are purged from object storage within seven days.
        Backups roll off within thirty days.
      </p>

      <h2>Your rights</h2>
      <p>
        You have the right to access, correct, and delete your information. For account information,
        the controls are in the dashboard. For claim information that needs to be corrected (typo in
        patient name, wrong member ID), edit the row in the claim detail page; we audit-log the
        change. For deletion, see the previous section.
      </p>
      <p>
        If you are a California resident exercising rights under the CCPA, write to{' '}
        <a href="mailto:privacy@dentabill.example">privacy@dentabill.example</a>. We respond within
        30 days.
      </p>

      <h2>Children</h2>
      <p>
        DentaBill is a B2B tool used by dental practices. We do not knowingly collect information
        from children under 13 directly; PHI for minor patients flows through the practice as a
        normal part of the BAA-covered workflow.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        We post material changes here and notify account owners by email at least 14 days before
        they take effect. Minor edits (typos, clarifications) update the &quot;Effective&quot; date
        at the top.
      </p>

      <h2>Contact</h2>
      <p>
        Privacy questions: <a href="mailto:privacy@dentabill.example">privacy@dentabill.example</a>.
        BAA questions: <a href="mailto:legal@dentabill.example">legal@dentabill.example</a>.
        Security findings:{' '}
        <a href="mailto:security@dentabill.example">security@dentabill.example</a>.
      </p>
    </LegalDoc>
  );
}
