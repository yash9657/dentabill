import { Pill } from '@dentabill/ui';
import type { Metadata } from 'next';
import * as React from 'react';

export const metadata: Metadata = {
  title: 'Security',
  description:
    'How DentaBill handles PHI, BAAs, sub-processors, and vulnerability disclosure. Written for billing leads and security reviewers, not for marketing.',
  alternates: { canonical: '/security' },
};

/**
 * /security — public security statement.
 *
 * Written to be useful to two audiences:
 *
 *   1. A practice manager doing the BAA conversation. They want
 *      enough plain language to feel comfortable signing.
 *   2. An IT or security reviewer doing diligence on a vendor.
 *      They want sub-processors, regions, and a vulnerability
 *      disclosure address.
 *
 * Both get answers without trust badges, lock icons, or stock
 * photography of fingerprints. The page is text-led on purpose;
 * security pages that lean on iconography always feel templated,
 * and a security reviewer reading marketing copy is not the kind of
 * audience to win over with visuals.
 *
 * The sub-processor table is the only "table" on the marketing
 * site. It earns the affordance — three columns of fact, twelve
 * rows planned — because the list scans faster as a table than as
 * prose.
 *
 * Status page link is a stub today (lands in Phase 5 with the
 * cloud target); we keep the affordance so security reviewers
 * looking for it know it exists in the roadmap.
 */
export default function SecurityPage(): React.ReactElement {
  return (
    <main>
      <Header />
      <HipaaStance />
      <Baa />
      <SubProcessors />
      <Disclosure />
      <ComplianceRoadmap />
      <ClosingCta />
    </main>
  );
}

function Header(): React.ReactElement {
  return (
    <section className="mx-auto max-w-3xl px-4 pb-16 pt-24 sm:px-6 sm:pt-32 lg:px-8">
      <p className="text-caption text-gray-warm mb-4 uppercase tracking-[0.14em]">Security</p>
      <h1 className="font-display mb-6 text-balance text-[40px] font-extralight leading-[1.08] tracking-[-0.02em] text-black sm:text-[52px]">
        We are paid to call insurance companies. We are not paid to keep your patient data, and we
        do not.
      </h1>
      <p className="text-body-large text-gray-dark max-w-2xl">
        This page is written for the billing lead doing the BAA conversation and for the security
        reviewer doing diligence. Both should walk away with enough information to make a decision.
      </p>
    </section>
  );
}

function HipaaStance(): React.ReactElement {
  return (
    <section
      aria-labelledby="hipaa-heading"
      className="mx-auto max-w-3xl px-4 pb-24 sm:px-6 lg:px-8"
    >
      <p className="text-caption text-gray-warm mb-3 uppercase tracking-[0.14em]">PHI handling</p>
      <h2
        id="hipaa-heading"
        className="font-display text-section-heading mb-8 text-balance font-light text-black"
      >
        Patient names never reach our application logs.
      </h2>
      <div className="text-body text-gray-dark space-y-5">
        <p>
          The <code className="font-mono text-[0.95em] text-black">@dentabill/logger</code> package
          redacts patient names, dates of birth, member IDs, and Social Security numbers before any
          log line leaves the runtime. The redaction is applied at the transport layer, so an
          application engineer who forgets cannot leak PHI through a stray{' '}
          <code className="font-mono text-[0.95em] text-black">console.log</code>.
        </p>
        <p>
          Patient dates of birth are hashed with a per-organisation secret before they leave the
          dashboard. The DOB never touches our database in plain text. We use the hash for IVR
          identity verification with the payer; we cannot reverse it.
        </p>
        <p>
          Every database read is org-scoped at a layer below the application. Cross-tenant access is
          a build-time error, not a code review heuristic. A developer cannot accidentally read
          another organisation&apos;s data even if the application code is wrong.
        </p>
        <p>
          Call recordings are encrypted at rest with AES-256 and access-logged. They are retained
          for the period your BAA specifies and are purgeable on request within seven days.
        </p>
      </div>
    </section>
  );
}

function Baa(): React.ReactElement {
  return (
    <section aria-labelledby="baa-heading" className="bg-gray-light border-border-subtle border-t">
      <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
        <p className="text-caption text-gray-warm mb-3 uppercase tracking-[0.14em]">
          Business associate agreement
        </p>
        <h2
          id="baa-heading"
          className="font-display text-section-heading mb-8 text-balance font-light text-black"
        >
          We sign a BAA with every customer.
        </h2>
        <div className="text-body text-gray-dark space-y-5">
          <p>
            DentaBill is a HIPAA Business Associate. We sign a BAA before any production data
            touches our system. Our standard BAA is based on the OCR Sample Business Associate
            Agreement and is available for legal review on request.
          </p>
          <p>
            We do not gate features behind tier on the BAA. Starter, Professional, and Enterprise
            customers all have the same BAA available. The Enterprise tier adds the option of mutual
            NDA and a customer-redlined version.
          </p>
          <p>
            To request a draft BAA, write to{' '}
            <a
              className="text-black underline underline-offset-2 hover:no-underline"
              href="mailto:legal@dentabill.example"
            >
              legal@dentabill.example
            </a>
            . We respond within one business day.
          </p>
        </div>
      </div>
    </section>
  );
}

interface SubProcessor {
  readonly name: string;
  readonly purpose: string;
  readonly region: string;
}

const SUB_PROCESSORS: readonly SubProcessor[] = [
  { name: 'Clerk', purpose: 'Authentication and organisation management', region: 'United States' },
  { name: 'Neon (Postgres)', purpose: 'Primary application database', region: 'United States' },
  { name: 'Upstash (Redis)', purpose: 'Job queue and rate limiting', region: 'United States' },
  { name: 'Retell AI', purpose: 'Voice synthesis and speech-to-text', region: 'United States' },
  { name: 'Anthropic', purpose: 'Post-call summarisation', region: 'United States' },
  { name: 'AWS S3', purpose: 'Encrypted call recording storage', region: 'us-east-1' },
  { name: 'Stripe', purpose: 'Payment processing (no PHI)', region: 'United States' },
  { name: 'Resend', purpose: 'Transactional email (no PHI)', region: 'United States' },
  { name: 'Sentry', purpose: 'Error monitoring (PHI-redacted)', region: 'United States' },
];

function SubProcessors(): React.ReactElement {
  return (
    <section
      aria-labelledby="subprocessors-heading"
      className="border-border-subtle border-t bg-white"
    >
      <div className="mx-auto max-w-5xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
        <p className="text-caption text-gray-warm mb-3 uppercase tracking-[0.14em]">
          Sub-processors
        </p>
        <h2
          id="subprocessors-heading"
          className="font-display text-section-heading mb-4 max-w-2xl text-balance font-light text-black"
        >
          The vendors we share data with, and what they do with it.
        </h2>
        <p className="text-body text-gray-dark mb-12 max-w-2xl">
          We update this list at least 30 days before a new sub-processor begins handling production
          data. Subscribe to{' '}
          <a
            className="text-black underline underline-offset-2 hover:no-underline"
            href="mailto:security@dentabill.example?subject=Subscribe%20to%20sub-processor%20updates"
          >
            security@dentabill.example
          </a>{' '}
          to be notified.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-border-light border-b">
                <th
                  scope="col"
                  className="text-caption text-gray-warm py-3 pr-6 font-medium uppercase tracking-[0.14em]"
                >
                  Vendor
                </th>
                <th
                  scope="col"
                  className="text-caption text-gray-warm py-3 pr-6 font-medium uppercase tracking-[0.14em]"
                >
                  Purpose
                </th>
                <th
                  scope="col"
                  className="text-caption text-gray-warm py-3 font-medium uppercase tracking-[0.14em]"
                >
                  Region
                </th>
              </tr>
            </thead>
            <tbody>
              {SUB_PROCESSORS.map((p) => (
                <tr
                  key={p.name}
                  className="border-border-subtle border-b align-baseline last:border-0"
                >
                  <td className="text-body py-4 pr-6 font-medium text-black">{p.name}</td>
                  <td className="text-body text-gray-dark py-4 pr-6">{p.purpose}</td>
                  <td className="text-body text-gray-dark whitespace-nowrap py-4">{p.region}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Disclosure(): React.ReactElement {
  return (
    <section
      aria-labelledby="disclosure-heading"
      className="bg-gray-light border-border-subtle border-t"
    >
      <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
        <p className="text-caption text-gray-warm mb-3 uppercase tracking-[0.14em]">
          Vulnerability disclosure
        </p>
        <h2
          id="disclosure-heading"
          className="font-display text-section-heading mb-8 text-balance font-light text-black"
        >
          Found something? Tell us first, in writing.
        </h2>
        <div className="text-body text-gray-dark space-y-5">
          <p>
            Send security findings to{' '}
            <a
              className="text-black underline underline-offset-2 hover:no-underline"
              href="mailto:security@dentabill.example"
            >
              security@dentabill.example
            </a>
            . We acknowledge within one business day and aim to resolve high-severity findings
            within seven days.
          </p>
          <p>
            We do not run a public bug bounty yet. We do credit researchers in our release notes
            (with permission) and respect responsible disclosure. We will not pursue legal action
            against good-faith researchers operating within the scope below.
          </p>
          <p className="text-body-small">
            <strong className="text-black">In scope:</strong> dentabill.example, the application at
            app.dentabill.example, and the API at api.dentabill.example.{' '}
            <strong className="text-black">Out of scope:</strong> social engineering, denial of
            service, or any test that touches a customer&apos;s real PHI.
          </p>
        </div>
      </div>
    </section>
  );
}

function ComplianceRoadmap(): React.ReactElement {
  return (
    <section
      aria-labelledby="compliance-heading"
      className="border-border-subtle border-t bg-white"
    >
      <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
        <p className="text-caption text-gray-warm mb-3 uppercase tracking-[0.14em]">Compliance</p>
        <h2
          id="compliance-heading"
          className="font-display text-section-heading mb-8 text-balance font-light text-black"
        >
          Where we are on SOC 2 and the public status page.
        </h2>
        <div className="text-body text-gray-dark space-y-5">
          <p>
            SOC 2 Type II is in progress with an external auditor. We expect a Type I letter in the
            next quarter and a Type II report after a 6-month observation window. We are happy to
            share our control narrative under NDA in the interim.
          </p>
          <p>
            A public status page lands with the production deployment in Phase 5. Until then,
            incident communication runs through the email address in your BAA contact block.
          </p>
        </div>
      </div>
    </section>
  );
}

function ClosingCta(): React.ReactElement {
  return (
    <section aria-label="Get in touch" className="bg-warm-stone/40 border-border-subtle border-t">
      <div className="mx-auto flex max-w-3xl flex-col items-start gap-6 px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
        <h2 className="font-display text-section-heading text-balance font-light text-black">
          If you are a security reviewer, ask us anything.
        </h2>
        <p className="text-body text-gray-dark max-w-xl">
          We will set up a call with whichever engineer wrote the part of the system you have
          questions about. Architecture, threat model, audit log, deletion paths.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Pill href="/contact" variant="black" withArrow>
            Talk to security
          </Pill>
          <Pill href="/sign-up" variant="whiteShadow">
            Start free trial
          </Pill>
        </div>
      </div>
    </section>
  );
}
