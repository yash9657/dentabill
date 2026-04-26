import { Pill } from '@dentabill/ui';
import type { Metadata } from 'next';
import * as React from 'react';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'DentaBill pricing — pay per call, with tiers shaped around how many claims a practice follows up on. Starter is free for the first 50 claims a month.',
  alternates: { canonical: '/pricing' },
};

/**
 * /pricing — three tiers laid out as full-width vertical rows
 * separated by warm hairlines, deliberately NOT three identical
 * pricing cards (the SaaS reflex). Each row breaks into:
 *
 *   - eyebrow ("Tier 01") + tier name + who it's for
 *   - the price block, set right-aligned at lg+
 *   - a short included-features list, indented under the price
 *
 * Standard "pricing comparison table" is skipped on purpose. It
 * doesn't help a buyer in this product — every tier includes the
 * same product, the only thing that varies is the call ceiling and
 * the support shape. A row layout makes that obvious; a table would
 * fill four columns of identical checkmarks, which is the classic
 * "cards are the lazy answer" failure (Impeccable shared design law).
 *
 * Inline pricing FAQ at the bottom (not an accordion) covers the
 * five questions that actually come up in calls. The full FAQ at
 * /faq lands in P2-T25; this page only owns the pricing-specific
 * questions.
 */
export default function PricingPage(): React.ReactElement {
  return (
    <main>
      <Header />
      <Tiers />
      <PricingFaq />
      <ClosingCta />
    </main>
  );
}

function Header(): React.ReactElement {
  return (
    <section className="mx-auto max-w-3xl px-4 pb-16 pt-24 sm:px-6 sm:pt-32 lg:px-8">
      <p className="text-caption text-gray-warm mb-4 uppercase tracking-[0.14em]">Pricing</p>
      <h1 className="font-display mb-6 text-balance text-[40px] font-extralight leading-[1.08] tracking-[-0.02em] text-black sm:text-[52px]">
        Pay per call. Tier shapes around how many you make.
      </h1>
      <p className="text-body-large text-gray-dark max-w-2xl">
        Starter is free for the first fifty claims a month. After that the per-call fee pays for
        itself the first time we save your front desk an hour. There is no setup fee, no per-seat
        upcharge, and no annual commitment.
      </p>
    </section>
  );
}

interface Tier {
  readonly n: string;
  readonly name: string;
  readonly summary: string;
  readonly price: string;
  readonly qualifier: string;
  readonly features: readonly string[];
  readonly cta: { readonly label: string; readonly href: string };
}

const TIERS: readonly Tier[] = [
  {
    n: '01',
    name: 'Starter',
    summary: 'Solo practices and front-desk teams trying DentaBill on a real claim queue.',
    price: 'Free',
    qualifier: 'first 50 claims a month, then $0.95 / call',
    features: [
      'Up to 50 claim follow-up calls a month at no cost',
      'Delta Dental PPO, Cigna Dental, MetLife Dental',
      'Email-only support',
      'BAA available on request',
    ],
    cta: { label: 'Start free trial', href: '/sign-up' },
  },
  {
    n: '02',
    name: 'Professional',
    summary: 'Multi-provider practices with a dedicated billing team.',
    price: '$0.79',
    qualifier: 'per call, billed monthly, 250-call minimum',
    features: [
      'Unlimited concurrent calls',
      'All payers in our coverage list',
      'Priority support, 24-hour response',
      'Per-payer denial pattern reports',
      'Single sign-on (Clerk)',
    ],
    cta: { label: 'Start free trial', href: '/sign-up' },
  },
  {
    n: '03',
    name: 'Enterprise',
    summary: 'DSOs and groups running claim follow-up across multiple locations.',
    price: 'Talk to us',
    qualifier: 'volume pricing, custom payer onboarding',
    features: [
      'Custom payer maps (we add IVRs you need that we do not yet cover)',
      'Dedicated implementation engineer',
      'Quarterly review with our team',
      'SCIM, audit log export, sub-processor list on request',
      'Mutual NDA + signed BAA + SOC 2 letter',
    ],
    cta: { label: 'Talk to enterprise', href: '/contact' },
  },
];

function Tiers(): React.ReactElement {
  return (
    <section aria-labelledby="tiers-heading" className="bg-gray-light border-t border-black/5">
      <h2 id="tiers-heading" className="sr-only">
        Tiers
      </h2>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        {TIERS.map((tier, idx) => (
          <React.Fragment key={tier.n}>
            <TierRow tier={tier} />
            {idx < TIERS.length - 1 ? (
              <div className="bg-warm-stone/60 h-px w-full" aria-hidden />
            ) : null}
          </React.Fragment>
        ))}
      </div>
    </section>
  );
}

function TierRow({ tier }: { readonly tier: Tier }): React.ReactElement {
  return (
    <div className="grid gap-10 py-20 lg:grid-cols-12 lg:gap-12 lg:py-24">
      <div className="lg:col-span-5">
        <p className="text-caption text-gray-warm mb-3 uppercase tracking-[0.14em]">
          Tier {tier.n}
        </p>
        <h3 className="font-display text-card-heading mb-4 text-balance font-light text-black">
          {tier.name}
        </h3>
        <p className="text-body text-gray-dark max-w-md">{tier.summary}</p>
      </div>

      <div className="lg:col-span-3">
        <p className="font-display text-[44px] font-extralight leading-none tracking-[-0.02em] text-black">
          {tier.price}
        </p>
        <p className="text-caption text-gray-warm mt-3 max-w-xs">{tier.qualifier}</p>
        <div className="mt-6">
          <Pill href={tier.cta.href} variant="black" size="sm" withArrow>
            {tier.cta.label}
          </Pill>
        </div>
      </div>

      <ul className="text-body text-gray-dark space-y-2 lg:col-span-4">
        {tier.features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </div>
  );
}

const PRICING_QUESTIONS: readonly { readonly q: string; readonly a: string }[] = [
  {
    q: 'How does the per-call billing work?',
    a: 'A "call" means one outbound dial that connects to a payer (IVR or human). Busy signals, dropped tones, and immediate disconnects do not count. If a payer disconnects mid-conversation, the redial is a single billed call, not two.',
  },
  {
    q: 'What if a call gets stuck on hold for an hour?',
    a: 'Hold time is on us. Long holds are a payer problem, not a customer problem, and the whole point of DentaBill is that nobody on your team has to wait. We escalate after 90 minutes; the call is still billed once.',
  },
  {
    q: 'Do I need to commit annually to get the Professional rate?',
    a: 'No. Professional is monthly. You can cancel any time and exported data ships in CSV the same day.',
  },
  {
    q: 'Is there a per-seat fee for additional billing staff?',
    a: 'Never. Add as many users from your practice as you want; pricing is on call volume only.',
  },
  {
    q: 'Can my DSO get a single bill across locations?',
    a: 'Yes, that is part of the Enterprise shape. Each location runs as its own multi-tenant organisation in DentaBill but rolls up into a single invoice.',
  },
];

function PricingFaq(): React.ReactElement {
  return (
    <section aria-labelledby="pricing-faq-heading" className="border-t border-black/5 bg-white">
      <div className="mx-auto max-w-5xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
        <p className="text-caption text-gray-warm mb-3 uppercase tracking-[0.14em]">
          Pricing questions
        </p>
        <h2
          id="pricing-faq-heading"
          className="font-display text-section-heading mb-12 max-w-2xl text-balance font-light text-black"
        >
          The five questions billing leads ask first.
        </h2>
        <dl className="space-y-10">
          {PRICING_QUESTIONS.map(({ q, a }) => (
            <div key={q} className="grid gap-3 lg:grid-cols-12 lg:gap-8">
              <dt className="font-body text-body text-balance font-medium text-black lg:col-span-5">
                {q}
              </dt>
              <dd className="text-body text-gray-dark lg:col-span-7">{a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function ClosingCta(): React.ReactElement {
  return (
    <section aria-label="Get started" className="bg-warm-stone/40 border-t border-black/5">
      <div className="mx-auto flex max-w-3xl flex-col items-start gap-6 px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
        <h2 className="font-display text-section-heading text-balance font-light text-black">
          The first fifty calls are free. The fifty-first will pay for the rest of the month.
        </h2>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Pill href="/sign-up" variant="black" withArrow>
            Start free trial
          </Pill>
          <Pill href="/contact" variant="whiteShadow">
            Talk to enterprise
          </Pill>
        </div>
      </div>
    </section>
  );
}
