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
    <main id="main-content">
      <section className="mx-auto max-w-6xl px-4 pb-32 pt-24 sm:px-6 sm:pt-32 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <h1 className="font-display mb-6 text-balance text-[40px] font-normal leading-[1.08] tracking-[-0.02em] text-black sm:text-[52px]">
              Let’s talk about your practice.
            </h1>
            <div className="text-body text-gray-dark space-y-4">
              <p>
                Tell us about the claims you follow up on and the payers you work with. We’ll help
                you see where DentaBill fits into your day.
              </p>
              <p>
                Have a question about security, your BAA, or getting started? Include it in your
                message and our team will follow up.
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
