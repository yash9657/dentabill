import { Pill, StatusDot } from '@dentabill/ui';
import * as React from 'react';

import { CallFlowWaveform } from '../../components/marketing/call-flow-waveform.js';

/**
 * Marketing landing page (P2-T18).
 *
 * Composed of five quiet, distinct sections — each with its own
 * spacing rhythm so the page reads as a sequence of exhibits rather
 * than a card grid. The visual language is ADR-013: achromatic with
 * warm undertones; the only chromatic moment is the muted-teal status
 * accent on the live-call indicator (and the matching cluster in the
 * call-flow waveform).
 *
 * Sections:
 *   1. Hero — oversized weight-200 headline, explanatory subhead, two
 *      CTAs, the call-flow waveform sitting beneath as a quiet exhibit.
 *   2. Live-status strip — single horizontal line with the chromatic
 *      status dot (the brand's only moment of color), tying the
 *      product promise back to the visual system.
 *   3. How it works — three numbered steps in a flowing row; varied
 *      typography per step (numeral huge, heading mid, body small) so
 *      it's not three identical cards.
 *   4. Capabilities — two alternating panels at full bleed. Plain
 *      text + a small inset illustration each. Text-led, not
 *      icon-led.
 *   5. Closing CTA — a single line + the same two pills, set against
 *      a quiet warm-stone band so the eye knows the page has landed.
 *
 * The marketing layout already provides the header, footer, and
 * cookie banner.
 */
export default function HomePage(): React.ReactElement {
  return (
    <main>
      <Hero />
      <LiveStatusStrip />
      <HowItWorks />
      <Capabilities />
      <ClosingCta />
    </main>
  );
}

function Hero(): React.ReactElement {
  return (
    <section className="mx-auto flex max-w-5xl flex-col items-center gap-10 px-4 pb-16 pt-24 sm:px-6 sm:pt-32 lg:px-8">
      <h1 className="font-display max-w-4xl text-balance text-center text-[44px] font-extralight leading-[1.06] tracking-[-0.02em] text-black sm:text-[56px] md:text-[64px]">
        Stop waiting on hold with insurance.
      </h1>

      <p className="text-body-large text-gray-dark max-w-2xl text-balance text-center">
        DentaBill is an AI voice agent for dental billing teams. It calls payers, navigates IVRs,
        waits on hold, talks to a real rep, and returns structured claim status. Your front desk
        gets time back.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Pill href="/sign-up" variant="black" withArrow>
          Start free trial
        </Pill>
        <Pill href="/contact" variant="warmStone" size="warm">
          Book a 20-minute demo
        </Pill>
      </div>

      <div className="mt-10 w-full max-w-3xl">
        <CallFlowWaveform className="h-auto w-full text-black" />
      </div>
    </section>
  );
}

function LiveStatusStrip(): React.ReactElement {
  return (
    <section
      aria-label="Live call indicator example"
      className="mx-auto max-w-5xl px-4 pb-24 sm:px-6 lg:px-8"
    >
      <div className="hairline-edge flex flex-col gap-4 rounded-[20px] bg-white px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex items-center gap-3">
          <StatusDot variant="active" />
          <span className="font-body text-body-standard text-black">
            Calling Delta Dental PPO for claim #84219
          </span>
        </div>
        <span className="text-caption text-gray-warm font-mono">on hold, 4m 12s</span>
      </div>
      <p className="text-caption text-gray-warm mt-4 max-w-md">
        The teal dot is the only color in the system. It only ever appears when a call is live.
      </p>
    </section>
  );
}

function HowItWorks(): React.ReactElement {
  const steps: readonly { readonly n: string; readonly title: string; readonly body: string }[] = [
    {
      n: '01',
      title: 'Upload a CSV of pending claims',
      body: 'Dentrix, Eaglesoft, Open Dental. We detect the schema, hash patient identifiers, and queue each claim by amount, age, and prior denial pattern.',
    },
    {
      n: '02',
      title: 'The agent dials the payer',
      body: 'It navigates the IVR with DTMF, waits on hold, then talks to a real claims rep. Voice and tone are calibrated for the payer; conversation rules come from the IVR map.',
    },
    {
      n: '03',
      title: 'You read the result, not the transcript',
      body: 'Status, denial reason if any, next-action plan. Full transcript and recording are kept for audit, but your billing team works from a structured summary.',
    },
  ];

  return (
    <section
      aria-labelledby="how-it-works-heading"
      className="bg-gray-light border-t border-black/5"
    >
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
        <div className="mb-16 max-w-2xl">
          <p className="text-caption text-gray-warm mb-3 uppercase tracking-[0.14em]">
            How it works
          </p>
          <h2
            id="how-it-works-heading"
            className="font-display text-section-heading text-balance font-light text-black"
          >
            One CSV in. Structured claim status out. No queue staff in between.
          </h2>
        </div>

        <ol className="grid gap-12 md:grid-cols-3 md:gap-8 lg:gap-12">
          {steps.map((s) => (
            <li key={s.n} className="flex flex-col gap-3">
              <span
                aria-hidden
                className="font-display text-gray-warm text-[56px] font-extralight leading-none tracking-[-0.02em]"
              >
                {s.n}
              </span>
              <h3 className="font-display text-card-heading text-balance font-light text-black">
                {s.title}
              </h3>
              <p className="text-body text-gray-dark">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Capabilities(): React.ReactElement {
  return (
    <section aria-labelledby="capabilities-heading" className="border-t border-black/5 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
        <h2 id="capabilities-heading" className="sr-only">
          Capabilities
        </h2>

        <CapabilityRow
          eyebrow="Calls run while you sleep"
          headline="Your queue runs at 6 a.m. Your team sees the results at 9."
          body="DentaBill can dial overnight when payer call volume is lowest. Claims that would have spent a full day on hold get resolved before the front desk's coffee is cold. Status, denial reason, and next-action plan are waiting in the dashboard."
        />

        <div className="bg-warm-stone/50 my-20 h-px w-full" aria-hidden />

        <CapabilityRow
          eyebrow="Built for HIPAA from the inside"
          headline="Patient names never reach our logs. Recordings are encrypted at rest and tied to a BAA."
          body="DOBs are hashed with a per-organisation secret before they leave your dashboard. Every read is org-scoped at the database layer; cross-tenant access is a build-time error, not a code review heuristic. The runtime layer redacts PHI from logs even when the application code forgets."
          flip
        />
      </div>
    </section>
  );
}

interface CapabilityRowProps {
  readonly eyebrow: string;
  readonly headline: string;
  readonly body: string;
  readonly flip?: boolean;
}

function CapabilityRow({
  eyebrow,
  headline,
  body,
  flip = false,
}: CapabilityRowProps): React.ReactElement {
  return (
    <div className={`grid items-center gap-12 md:grid-cols-12 ${flip ? 'md:[direction:rtl]' : ''}`}>
      <div className="md:col-span-7 md:[direction:ltr]">
        <p className="text-caption text-gray-warm mb-3 uppercase tracking-[0.14em]">{eyebrow}</p>
        <h3 className="font-display text-card-heading text-balance font-light text-black">
          {headline}
        </h3>
      </div>
      <div className="md:col-span-5 md:[direction:ltr]">
        <p className="text-body text-gray-dark">{body}</p>
      </div>
    </div>
  );
}

function ClosingCta(): React.ReactElement {
  return (
    <section aria-label="Get started" className="bg-warm-stone/40 border-t border-black/5">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 px-4 py-24 text-center sm:px-6 sm:py-32 lg:px-8">
        <h2 className="font-display text-section-heading text-balance font-light text-black">
          Give your front desk back the morning.
        </h2>
        <p className="text-body text-gray-dark max-w-xl text-balance">
          Free for the first 50 claims. No card required. Claim follow-up that runs while your
          office sleeps.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Pill href="/sign-up" variant="black" withArrow>
            Start free trial
          </Pill>
          <Pill href="/contact" variant="whiteShadow">
            Book a 20-minute demo
          </Pill>
        </div>
      </div>
    </section>
  );
}
