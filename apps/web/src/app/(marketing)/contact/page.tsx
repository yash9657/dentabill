import type { Metadata } from 'next';
import * as React from 'react';

import { ContactForm } from '../../../components/marketing/contact-form.js';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Talk to the DentaBill team. Tell us how many claims your practice follows up on a week and which payers you work with most. We will set up a 20-minute call within one business day.',
  alternates: { canonical: '/contact' },
};

/**
 * /contact — the form is the page.
 *
 * Two-column layout at lg+ (intro copy on the left, form on the
 * right). Stacks below lg so the form is the first thing a phone
 * visitor sees. The form lives in `<ContactForm>` (Client Component);
 * everything else here is plain RSC so the typed metadata / SEO
 * surface stays static.
 */
export default function ContactPage(): React.ReactElement {
  return (
    <main>
      <section className="mx-auto max-w-6xl px-4 pb-32 pt-24 sm:px-6 sm:pt-32 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <p className="text-caption text-gray-warm mb-4 uppercase tracking-[0.14em]">Contact</p>
            <h1 className="font-display mb-6 text-balance text-[40px] font-extralight leading-[1.08] tracking-[-0.02em] text-black sm:text-[52px]">
              Tell us about your practice. We will write back today.
            </h1>
            <div className="text-body text-gray-dark space-y-4">
              <p>
                You will hear from a real engineer, not a sales rep. We will set up a 20-minute call
                to walk through whether DentaBill is a fit and answer any questions about BAA,
                sub-processors, or the underlying voice agent.
              </p>
              <p>
                If you are a security reviewer, send to{' '}
                <a
                  href="mailto:security@dentabill.example"
                  className="text-black underline underline-offset-2 hover:no-underline"
                >
                  security@dentabill.example
                </a>{' '}
                instead. If you are press, write to{' '}
                <a
                  href="mailto:press@dentabill.example"
                  className="text-black underline underline-offset-2 hover:no-underline"
                >
                  press@dentabill.example
                </a>
                .
              </p>
            </div>
          </div>

          <div className="lg:col-span-7">
            <ContactForm />
          </div>
        </div>
      </section>
    </main>
  );
}
