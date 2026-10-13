import { Pill } from '@dentabill/ui';
import { Check } from 'lucide-react';
import type { Metadata } from 'next';
import * as React from 'react';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Free for dental practices. No tiers, per-seat fees, or credit card required.',
  alternates: { canonical: '/pricing' },
};
const features = [
  [
    'Unlimited claim follow-up calls',
    'Follow up with supported payers without call ceilings or overage charges.',
  ],
  ['All supported payers from day one', 'Delta Dental PPO, Cigna Dental, and MetLife Dental.'],
  [
    'Structured claim status, not transcripts',
    'Get the status, denial reason, and a clear next-action plan.',
  ],
  ['Privacy built into your workflow', 'Encrypted recordings and a BAA available on request.'],
  ['Email support', 'Reach the team with questions, feedback, and feature requests.'],
  ['Multi-user access', 'Bring your billing staff, providers, and office managers together.'],
] as const;
export default function PricingPage(): React.ReactElement {
  return (
    <main id="main-content">
      <section className="page-container grid items-start gap-12 py-16 lg:grid-cols-[1fr_0.8fr] lg:gap-24 lg:py-24">
        <div>
          <h1 className="font-display text-hero font-normal">
            Free for practices.
            <br />
            <em className="text-brand">Forever.</em>
          </h1>
          <p className="text-body text-gray-dark mt-6 max-w-lg">
            Your front desk has enough to worry about. The cost of following up on a claim shouldn’t
            be one of them.
          </p>
          <p className="text-body-standard text-gray-dark mt-5 max-w-lg">
            Every practice gets full access. No tiers, per-seat fees, or upgrade prompts.
          </p>
        </div>
        <div className="rounded-card shadow-warm bg-white p-8 sm:p-10">
          <h2 className="text-brand text-base font-medium">The practice plan</h2>
          <p className="my-5 flex items-baseline gap-3">
            <span className="text-6xl font-semibold tracking-tight text-black">$0</span>
            <span className="text-caption text-gray-warm">per month, always</span>
          </p>
          <p className="text-gray-dark mb-7 text-sm">
            Everything your team needs to start following up.
          </p>
          <Pill href="/sign-up" size="lg" withArrow className="w-full">
            Get started free
          </Pill>
          <p className="text-gray-warm mt-4 text-center text-xs">
            No credit card. No trial period.
          </p>
          <ul className="border-border-subtle text-gray-dark mt-7 space-y-3 border-t pt-6 text-sm">
            {['Unlimited follow-up calls', 'All supported payers', 'Your whole billing team'].map(
              (item) => (
                <li key={item} className="flex items-center gap-3">
                  <Check size={16} className="text-brand" />
                  {item}
                </li>
              ),
            )}
          </ul>
        </div>
      </section>
      <section className="border-border-light border-y bg-white">
        <div className="page-container py-16 lg:py-20">
          <h2 className="font-display text-section-heading font-normal">What you get</h2>
          <ul className="mt-10 grid gap-x-16 sm:grid-cols-2">
            {features.map(([title, description]) => (
              <li key={title} className="border-border-subtle flex gap-4 border-t py-6">
                <Check size={18} className="text-brand mt-1 shrink-0" />
                <div>
                  <h3 className="text-base font-medium">{title}</h3>
                  <p className="text-gray-dark mt-2 max-w-md text-sm leading-relaxed">
                    {description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="page-container grid gap-8 py-16 lg:grid-cols-[1fr_1.2fr] lg:gap-24 lg:py-20">
        <h2 className="font-display text-section-heading font-normal">
          How this is <br />
          sustainable
        </h2>
        <div className="text-body-standard text-gray-dark space-y-5">
          <p>
            We built DentaBill because dental billing teams spend too much time on hold with
            insurance. We want every practice to have access to a better way.
          </p>
          <p>
            We are exploring partnerships with dental DSOs, practice management systems, and group
            purchasing organizations. Until those partnerships mature, we are funding DentaBill
            through our own resources.
          </p>
          <p>Our commitment is to keep it free for practices.</p>
        </div>
      </section>
      <section className="bg-brand-soft">
        <div className="page-container flex flex-col items-start gap-6 py-14 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-display text-section-heading max-w-2xl font-normal">
            No card required. No trial period.
            <br />
            Just log in and use it.
          </h2>
          <Pill href="/sign-up" size="lg" withArrow>
            Get started free
          </Pill>
        </div>
      </section>
    </main>
  );
}
