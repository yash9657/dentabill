import Link from 'next/link';
import * as React from 'react';

import { NewsletterSignupStub } from './newsletter-signup-stub.js';
import { Wordmark } from './wordmark.js';

/**
 * Marketing footer. Multi-column links + newsletter signup + copyright
 * row. Achromatic per ADR-013 — uses `text-gray-dark` for body links
 * and `text-gray-warm` for the colophon line at the bottom.
 *
 * The link map below is the canonical source for the footer columns;
 * adding a marketing page in P2-T19 → T26 means adding a row here at
 * the same time so the page is reachable from every other page.
 *
 * `<footer role="contentinfo">` is the implicit role for `<footer>`
 * when it's a top-level landmark, but we name the columns with
 * `<h2 className="sr-only">` headings so the screen-reader landmark
 * navigation announces meaningful section titles instead of "footer
 * navigation 1, 2, 3".
 */
const FOOTER_COLUMNS: readonly {
  readonly heading: string;
  readonly links: readonly { readonly href: string; readonly label: string }[];
}[] = [
  {
    heading: 'Product',
    links: [
      { href: '/pricing', label: 'Pricing' },
      { href: '/security', label: 'Security' },
      { href: '/faq', label: 'FAQ' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/blog', label: 'Blog' },
      { href: '/contact', label: 'Contact' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
      { href: '/security', label: 'BAA & sub-processors' },
    ],
  },
];

export function MarketingFooter(): React.ReactElement {
  const year = new Date().getFullYear();

  return (
    <footer role="contentinfo" className="border-border-subtle border-t bg-white">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.5fr_2fr_1fr] lg:gap-16 lg:px-8">
        <div className="space-y-4">
          <Link href="/" aria-label="DentaBill home" className="rounded-sm">
            <Wordmark size="lg" />
          </Link>
          <p className="text-body text-gray-dark max-w-sm text-balance">
            AI voice agents that call dental insurance payers, navigate IVRs, and return structured
            claim status to your billing team.
          </p>
        </div>

        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3">
          {FOOTER_COLUMNS.map(({ heading, links }) => (
            <div key={heading}>
              <h2 className="text-caption mb-4 font-medium uppercase tracking-wide text-black">
                {heading}
              </h2>
              <ul className="space-y-2">
                {links.map(({ href, label }) => (
                  <li key={`${heading}-${href}-${label}`}>
                    <Link href={href} className="text-body text-gray-dark hover:text-black">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div>
          <h2 className="text-caption mb-4 font-medium uppercase tracking-wide text-black">
            Newsletter
          </h2>
          <NewsletterSignupStub />
        </div>
      </div>

      <div className="border-border-subtle border-t">
        <div className="text-caption text-gray-warm mx-auto flex max-w-6xl flex-col items-start gap-2 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>© {year} DentaBill. All rights reserved.</p>
          <p>HIPAA-aware by design. BAA available on request.</p>
        </div>
      </div>
    </footer>
  );
}
