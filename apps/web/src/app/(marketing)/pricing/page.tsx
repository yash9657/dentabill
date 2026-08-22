import { Pill } from '@dentabill/ui';
import type { Metadata } from 'next';
import * as React from 'react';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'DentaBill is free for dental practices forever. No tiers, no paywall, no "contact sales". Full access to all features.',
  alternates: { canonical: '/pricing' },
};

/**
 * /pricing — free forever messaging (P5-T6 G-D3).
 *
 * Replaced the three-tier structure with a single, simple statement:
 * DentaBill is free. Forever. No hidden tiers, no per-seat fees, no
 * paywalls. The page now focuses on the mission framing (why this matters),
 * what's included (everything), and an honest explanation of the business
 * model (how we stay sustainable without charging practices).
 *
 * Sections:
 *   1. Hero — "Free for practices. Forever." with mission context.
 *   2. What's included — everything the product offers, with no feature
 *      gating or "upgrade to unlock" mechanics.
 *   3. How we stay free — candid explanation of the business model, with
 *      no invented funding claims or fake numbers.
 *   4. Closing CTA — simple sign-up button.
 */
export default function PricingPage(): React.ReactElement {
  return (
    <main>
      <Header />
      <Included />
      <Sustainability />
      <ClosingCta />
    </main>
  );
}

function Header(): React.ReactElement {
  return (
    <section className="mx-auto max-w-3xl px-4 pb-16 pt-24 sm:px-6 sm:pt-32 lg:px-8">
      <p className="text-caption text-gray-warm mb-4 uppercase tracking-[0.14em]">Pricing</p>
      <h1 className="font-display text-hero mb-6 text-balance font-extralight text-black">
        Free for practices. Forever.
      </h1>
      <p className="text-body-large text-gray-dark max-w-2xl">
        DentaBill is built for dental billing teams, not to extract value from them. Every practice
        gets full access to the product — no tiers, no per-seat fees, no upgrade prompts. Your front
        desk gets the software it needs without worrying about cost.
      </p>
    </section>
  );
}

function Included(): React.ReactElement {
  return (
    <section
      aria-labelledby="included-heading"
      className="bg-gray-light border-border-subtle border-t"
    >
      <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
        <h2
          id="included-heading"
          className="font-display text-section-heading mb-12 font-light text-black"
        >
          What you get
        </h2>

        <ul className="space-y-6">
          <li className="flex gap-4">
            <span
              aria-hidden
              className="font-display text-gray-warm text-[28px] font-extralight leading-none"
            >
              •
            </span>
            <div className="flex flex-col gap-1">
              <h3 className="font-display text-card-heading font-light text-black">
                Unlimited claim follow-up calls
              </h3>
              <p className="text-body text-gray-dark">
                Call as many payers as you need. No call ceiling, no overage charges, no surprise
                bills.
              </p>
            </div>
          </li>

          <li className="flex gap-4">
            <span
              aria-hidden
              className="font-display text-gray-warm text-[28px] font-extralight leading-none"
            >
              •
            </span>
            <div className="flex flex-col gap-1">
              <h3 className="font-display text-card-heading font-light text-black">
                All supported payers from day one
              </h3>
              <p className="text-body text-gray-dark">
                Delta Dental PPO, Cigna Dental, MetLife Dental, and growing. If a payer becomes
                high-priority for your practice, tell us and we add it.
              </p>
            </div>
          </li>

          <li className="flex gap-4">
            <span
              aria-hidden
              className="font-display text-gray-warm text-[28px] font-extralight leading-none"
            >
              •
            </span>
            <div className="flex flex-col gap-1">
              <h3 className="font-display text-card-heading font-light text-black">
                Structured claim status, not transcripts
              </h3>
              <p className="text-body text-gray-dark">
                Every call returns status, denial reason if any, and a clear next-action plan. Your
                billing team works from a summary, not a raw call transcript.
              </p>
            </div>
          </li>

          <li className="flex gap-4">
            <span
              aria-hidden
              className="font-display text-gray-warm text-[28px] font-extralight leading-none"
            >
              •
            </span>
            <div className="flex flex-col gap-1">
              <h3 className="font-display text-card-heading font-light text-black">
                HIPAA-compliant from the ground up
              </h3>
              <p className="text-body text-gray-dark">
                BAA included. Patient names never reach our logs. Recordings are encrypted at rest.
                DOBs are hashed before they leave your dashboard.
              </p>
            </div>
          </li>

          <li className="flex gap-4">
            <span
              aria-hidden
              className="font-display text-gray-warm text-[28px] font-extralight leading-none"
            >
              •
            </span>
            <div className="flex flex-col gap-1">
              <h3 className="font-display text-card-heading font-light text-black">
                Email support
              </h3>
              <p className="text-body text-gray-dark">
                Direct access to the engineering team. Questions get answered, bugs get fixed, and
                feature requests get reviewed.
              </p>
            </div>
          </li>

          <li className="flex gap-4">
            <span
              aria-hidden
              className="font-display text-gray-warm text-[28px] font-extralight leading-none"
            >
              •
            </span>
            <div className="flex flex-col gap-1">
              <h3 className="font-display text-card-heading font-light text-black">
                Multi-user access
              </h3>
              <p className="text-body text-gray-dark">
                Add as many team members as you need. No per-seat fees. Billing staff, providers,
                office managers — everyone can see the dashboard.
              </p>
            </div>
          </li>
        </ul>
      </div>
    </section>
  );
}

function Sustainability(): React.ReactElement {
  return (
    <section
      aria-labelledby="sustainability-heading"
      className="border-border-subtle border-t bg-white"
    >
      <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
        <h2
          id="sustainability-heading"
          className="font-display text-section-heading mb-8 font-light text-black"
        >
          How this is sustainable
        </h2>
        <p className="text-body text-gray-dark mb-6">
          We built DentaBill because the problem is real: dental billing teams spend hours on hold
          with insurance, and there is no existing software that actually solves it. Charging
          practices for software they desperately need felt like the wrong lever.
        </p>
        <p className="text-body text-gray-dark mb-6">
          Instead, we are exploring sustainable revenue through partnerships with dental DSOs,
          practice management systems, and group purchasing organizations. Those partners benefit
          from the same claim follow-up automation, and we grow together without extracting margin
          from practices.
        </p>
        <p className="text-body text-gray-dark">
          Until those partnerships mature, we are funding this through our own resources. The
          product is complete, the infrastructure is solid, and the evidence that it works is clear.
          We are committed to keeping it free because that is what the mission demands.
        </p>
      </div>
    </section>
  );
}

function ClosingCta(): React.ReactElement {
  return (
    <section aria-label="Get started" className="bg-warm-stone/40 border-border-subtle border-t">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 px-4 py-24 text-center sm:px-6 sm:py-32 lg:px-8">
        <h2 className="font-display text-section-heading text-balance font-light text-black">
          No card required. No trial period. Just log in and use it.
        </h2>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Pill href="/sign-up" variant="black" withArrow>
            Get started free
          </Pill>
        </div>
      </div>
    </section>
  );
}
