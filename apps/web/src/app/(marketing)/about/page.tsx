import { Pill } from '@dentabill/ui';
import type { Metadata } from 'next';
import * as React from 'react';

export const metadata: Metadata = {
  title: 'About',
  description:
    'DentaBill is a small team building one tool well: an AI voice agent that calls dental insurance payers so billing staff stop waiting on hold.',
  alternates: { canonical: '/about' },
};

/**
 * /about — three quiet sections (origin, principles, contact CTA).
 *
 * The plan calls for "MDX-backed", but a single static page has no
 * authoring workflow that benefits from MDX. The MDX runtime arrives
 * with the blog (P2-T26) where there's actually a content collection
 * to manage. Until then, hand-written JSX keeps the build smaller and
 * the read clearer.
 *
 * Voice intentionally direct: no "we're on a mission to revolutionize",
 * no team grid, no "by the numbers". Billers and practice owners read
 * trade press; vague mission statements read as evasion.
 */
export default function AboutPage(): React.ReactElement {
  return (
    <main id="main-content">
      <section className="mx-auto max-w-3xl px-4 pb-16 pt-24 sm:px-6 sm:pt-32 lg:px-8">
        <h1 className="font-display text-balance text-[40px] font-normal leading-[1.08] tracking-[-0.02em] text-black sm:text-[52px]">
          Built for the people behind the practice.
        </h1>
      </section>

      <section className="mx-auto max-w-3xl px-4 pb-24 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <p className="text-body-large text-gray-dark">
            A typical dental practice spends two to three hours a day on the phone with insurance
            payers. The work is necessary and the work is mostly waiting. The conversation, when it
            finally happens, follows the same shape every time: name the claim, hear the status,
            note the next action.
          </p>
          <p className="text-body-large text-gray-dark">
            DentaBill is one tool that does that one thing. An AI voice agent dials the payer,
            navigates the IVR with DTMF, holds, talks to a real claims rep, and returns a structured
            summary your billing team can act on. The transcript and recording are kept for audit;
            your front desk works from the summary.
          </p>
          <p className="text-body-large text-gray-dark">
            We are a small team. We chose dental billing because the workflow is concrete, the payer
            set is finite, and the time savings are immediate and measurable. We are not building a
            horizontal voice platform. The whole product is shaped by what dental billers actually
            do.
          </p>
        </div>
      </section>

      <section
        aria-labelledby="principles-heading"
        className="bg-gray-light border-border-subtle border-t"
      >
        <div className="mx-auto max-w-5xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
          <h2
            id="principles-heading"
            className="font-display text-section-heading mb-16 max-w-2xl text-balance font-medium text-black"
          >
            What matters to us.
          </h2>
          <ol className="grid gap-12 md:grid-cols-3 md:gap-8 lg:gap-12">
            <Principle
              n="01"
              title="PHI is the boundary"
              body="Patient names, DOB, SSN, member IDs never reach our logs. Database access is org-scoped at the layer below the application, so cross-tenant access is a build-time error, not a code review heuristic. We assume any feature that requires us to log PHI is the wrong feature."
            />
            <Principle
              n="02"
              title="Calls are work, not magic"
              body="A call costs the payer a real seat-minute, and getting it wrong costs a denial. We retry on idempotent reads, never on mutations. We escalate to a human queue when an IVR map drifts. The agent is conservative on purpose."
            />
            <Principle
              n="03"
              title="One product done well"
              body="Your team needs clear answers and an obvious next step. We design around the daily work of a billing desk, with readable information, keyboard access, and responsive layouts."
            />
          </ol>
        </div>
      </section>

      <section aria-label="Get in touch" className="bg-warm-stone/40 border-border-subtle border-t">
        <div className="mx-auto flex max-w-3xl flex-col items-start gap-6 px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
          <h2 className="font-display text-section-heading text-balance font-medium text-black">
            If your practice is on hold right now, we would like to talk.
          </h2>
          <p className="text-body text-gray-dark max-w-xl">
            Tell us how many claims a week you follow up on and which payers you work with most. We
            will set up a 20-minute call and walk through whether DentaBill is a fit.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Pill href="/contact" variant="black" withArrow>
              Book a 20-minute demo
            </Pill>
            <Pill href="/sign-up" variant="whiteShadow">
              Get started free
            </Pill>
          </div>
        </div>
      </section>
    </main>
  );
}

interface PrincipleProps {
  readonly n: string;
  readonly title: string;
  readonly body: string;
}

function Principle({ n, title, body }: PrincipleProps): React.ReactElement {
  return (
    <li className="flex flex-col gap-3">
      <span
        aria-hidden
        className="font-display text-gray-warm text-[40px] font-normal leading-none tracking-[-0.02em]"
      >
        {n}
      </span>
      <h3 className="font-display text-card-heading text-balance font-medium text-black">
        {title}
      </h3>
      <p className="text-body text-gray-dark">{body}</p>
    </li>
  );
}
