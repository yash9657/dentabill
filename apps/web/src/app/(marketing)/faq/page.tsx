import { Pill } from '@dentabill/ui';
import { ChevronDown } from 'lucide-react';
import type { Metadata } from 'next';
import * as React from 'react';

export const metadata: Metadata = {
  title: 'FAQ',
  description:
    'Common questions about DentaBill: pricing, setup, HIPAA, payer coverage, and what happens when an IVR changes.',
  alternates: { canonical: '/faq' },
};

/**
 * /faq — categorised, native-`<details>` accordion.
 *
 * No MDX runtime here — same reasoning as /about: a single page does
 * not benefit from a content pipeline, and the blog at P2-T26 is the
 * right place to wire MDX. The accordion uses native
 * `<details><summary>` so keyboard activation, screen-reader
 * announcements, and `?#anchor` deep links all work without JS.
 *
 * Categories cluster questions the way prospects ask them: pricing
 * first because that's the most-asked, then setup, then HIPAA &
 * security, then payer coverage, then "what if it goes wrong". The
 * pricing-specific questions on the /pricing page (P2-T20) cover
 * billing semantics; this page is the broader FAQ. Cross-links keep
 * the two from duplicating.
 */
export default function FaqPage(): React.ReactElement {
  return (
    <main>
      <Header />
      {FAQ_CATEGORIES.map((cat, idx) => (
        <Category key={cat.id} category={cat} surface={idx % 2 === 0 ? 'light' : 'white'} />
      ))}
      <ClosingCta />
    </main>
  );
}

function Header(): React.ReactElement {
  return (
    <section className="mx-auto max-w-3xl px-4 pb-16 pt-24 sm:px-6 sm:pt-32 lg:px-8">
      <p className="text-caption text-gray-warm mb-4 uppercase tracking-[0.14em]">FAQ</p>
      <h1 className="font-display mb-6 text-balance text-[40px] font-extralight leading-[1.08] tracking-[-0.02em] text-black sm:text-[52px]">
        Questions we hear most from billing leads.
      </h1>
      <p className="text-body-large text-gray-dark max-w-2xl">
        If your question is not here, write to{' '}
        <a
          href="mailto:hello@dentabill.example"
          className="text-black underline underline-offset-2 hover:no-underline"
        >
          hello@dentabill.example
        </a>{' '}
        and we will reply today. For pricing-specific questions, see the inline FAQ on the{' '}
        <a href="/pricing" className="text-black underline underline-offset-2 hover:no-underline">
          pricing page
        </a>
        .
      </p>
    </section>
  );
}

interface QA {
  readonly q: string;
  readonly a: React.ReactNode;
}

interface FaqCategory {
  readonly id: string;
  readonly heading: string;
  readonly eyebrow: string;
  readonly items: readonly QA[];
}

const FAQ_CATEGORIES: readonly FaqCategory[] = [
  {
    id: 'setup',
    eyebrow: 'Setup',
    heading: 'Getting DentaBill running in your practice.',
    items: [
      {
        q: 'How long does setup take?',
        a: 'Most practices are running on the same day they sign up. Onboarding is: create an account, sign the BAA, upload a sample CSV from your practice management system, and tell us which payers you want covered first.',
      },
      {
        q: 'Do I need to involve IT?',
        a: 'No. DentaBill runs entirely in the browser; there is nothing to install on your front-desk machines. If your practice management system needs a CSV export job set up, that is a one-time configuration in your existing system.',
      },
      {
        q: 'Which practice management systems do you support?',
        a: 'We auto-detect the schema for Dentrix, Eaglesoft, and Open Dental at upload time. If your system exports a CSV with claim number, payer, patient identifier, date of service, and amount, we can usually map it; if it cannot, we add the mapping.',
      },
    ],
  },
  {
    id: 'pricing',
    eyebrow: 'Pricing',
    heading: 'How DentaBill charges, and what it does not charge for.',
    items: [
      {
        q: 'Is there a free tier?',
        a: 'Yes. Starter is free for the first 50 follow-up calls a month. Above that, the per-call fee applies. There is no per-seat fee at any tier.',
      },
      {
        q: 'Do I pay for time on hold?',
        a: 'No. Hold time is on us. Long holds are a payer problem, not a customer problem.',
      },
      {
        q: 'Where do I see the full pricing breakdown?',
        a: (
          <>
            On the <a href="/pricing">pricing page</a>. The inline FAQ there covers per-call billing
            semantics, the 250-call Professional minimum, and DSO multi-location billing.
          </>
        ),
      },
    ],
  },
  {
    id: 'hipaa',
    eyebrow: 'HIPAA & security',
    heading: 'How patient data is handled.',
    items: [
      {
        q: 'Do you sign a BAA?',
        a: (
          <>
            Yes, with every customer regardless of tier. The standard agreement is on the{' '}
            <a href="/security">security page</a>. Enterprise customers can request a redlined
            version.
          </>
        ),
      },
      {
        q: 'What patient information do you actually store?',
        a: 'The minimum needed to call the payer. Patient dates of birth are hashed with a per-organisation secret before they leave your dashboard; the DOB never reaches our database in plain text. Member IDs are encrypted at rest. Patient names never reach our application logs.',
      },
      {
        q: 'How long are call recordings kept?',
        a: 'Per your BAA, typically two years. Recordings are encrypted at rest and access-logged. They are purgeable on request within seven days.',
      },
    ],
  },
  {
    id: 'payers',
    eyebrow: 'Payer coverage',
    heading: 'Which insurance companies the agent can call.',
    items: [
      {
        q: 'Which payers are supported at launch?',
        a: 'Delta Dental PPO, Cigna Dental, and MetLife Dental at launch. The list grows on demand; if you tell us which payer is taking the most of your front desk time, we add it next.',
      },
      {
        q: 'What happens when a payer changes their IVR?',
        a: 'The agent escalates to a human queue and we update the IVR map. The change usually lands within 24 hours. Calls in flight at the moment of change are retried after the update without billing twice.',
      },
      {
        q: 'Can DentaBill handle denial calls and appeals?',
        a: 'Initial follow-up and routine status calls, yes. Formal appeals are out of scope today; the agent flags claims that need an appeal so a human in your billing team can take them on.',
      },
    ],
  },
  {
    id: 'integrations',
    eyebrow: 'Integrations',
    heading: 'How DentaBill plays with the rest of your stack.',
    items: [
      {
        q: 'Do you have an API?',
        a: 'Yes. The API is documented (OpenAPI generated from Zod) and available with a typed client (`@dentabill/api-sdk`). API access is included at the Professional tier.',
      },
      {
        q: 'Can I export call data to my own tools?',
        a: 'Yes. Every claim, call event, and structured summary can be exported as CSV from the dashboard. Enterprise customers get streaming exports via webhook.',
      },
    ],
  },
];

interface CategoryProps {
  readonly category: FaqCategory;
  readonly surface: 'light' | 'white';
}

function Category({ category, surface }: CategoryProps): React.ReactElement {
  const surfaceClass =
    surface === 'light'
      ? 'bg-gray-light border-t border-black/5'
      : 'border-t border-black/5 bg-white';
  return (
    <section aria-labelledby={`${category.id}-heading`} className={surfaceClass}>
      <div className="mx-auto max-w-5xl px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
        <p className="text-caption text-gray-warm mb-3 uppercase tracking-[0.14em]">
          {category.eyebrow}
        </p>
        <h2
          id={`${category.id}-heading`}
          className="font-display text-section-heading mb-12 max-w-2xl text-balance font-light text-black"
        >
          {category.heading}
        </h2>

        <ul className="divide-y divide-black/10 border-y border-black/10">
          {category.items.map((qa) => (
            <li key={qa.q}>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-5 [&::-webkit-details-marker]:hidden">
                  <span className="font-body text-body font-medium text-black">{qa.q}</span>
                  <ChevronDown
                    aria-hidden
                    className="text-gray-warm mt-0.5 h-5 w-5 flex-none transition-transform group-open:rotate-180"
                  />
                </summary>
                <div className="text-body text-gray-dark prose-style space-y-3 pb-6 pr-9 [&_a]:text-black [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:no-underline">
                  {typeof qa.a === 'string' ? <p>{qa.a}</p> : qa.a}
                </div>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ClosingCta(): React.ReactElement {
  return (
    <section aria-label="Get in touch" className="bg-warm-stone/40 border-t border-black/5">
      <div className="mx-auto flex max-w-3xl flex-col items-start gap-6 px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
        <h2 className="font-display text-section-heading text-balance font-light text-black">
          Still have a question?
        </h2>
        <p className="text-body text-gray-dark max-w-xl">
          Send the question to us directly. We will write back today, with the engineer who would be
          on the call rather than a sales script.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Pill href="/contact" variant="black" withArrow>
            Ask us anything
          </Pill>
          <Pill href="/sign-up" variant="whiteShadow">
            Start free trial
          </Pill>
        </div>
      </div>
    </section>
  );
}
