'use client';

import { cn, Pill } from '@dentabill/ui';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Wordmark } from './wordmark.js';

/**
 * Marketing site header. Sticky white surface (achromatic per ADR-013)
 * with the wordmark on the left, primary nav in the centre on desktop,
 * and a "Sign in" + "Start free trial" CTA pair on the right. Below
 * `lg`, the centre nav collapses into a hamburger menu that toggles a
 * mobile drawer rendered inline beneath the header.
 *
 * The header is `<header role="banner">`, the nav is `<nav
 * aria-label="Primary">`, and the mobile toggle is a real `<button>`
 * with `aria-expanded` + `aria-controls` so axe-core stays clean. The
 * sticky `top-0 z-40` keeps the chrome above page content during
 * scroll without overlapping the cookie banner (`z-50`).
 *
 * Why a Client Component: the mobile drawer needs `useState` to track
 * open/closed. Keeping the entire header client-side (rather than a
 * hybrid) avoids hydration boundary churn and is cheap — the rendered
 * markup is small and tree-shakeable.
 */
export const MARKETING_NAV_LINKS: readonly { readonly href: string; readonly label: string }[] = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/security', label: 'Security' },
  { href: '/about', label: 'About' },
  { href: '/blog', label: 'Blog' },
  { href: '/faq', label: 'FAQ' },
];

export interface MarketingHeaderProps {
  readonly className?: string;
}

export function MarketingHeader({ className }: MarketingHeaderProps): React.ReactElement {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const drawerId = React.useId();

  /**
   * Close the drawer on every route change. Without this, navigating
   * via a link inside the drawer leaves it visually open after the
   * route transition (Next.js doesn't unmount the layout component on
   * intra-segment navigation).
   */
  React.useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [mobileOpen]);

  return (
    <header
      role="banner"
      className={cn(
        'sticky top-0 z-40 w-full border-b border-black/5 bg-white/85 backdrop-blur',
        className,
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          aria-label="DentaBill home"
          className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
        >
          <Wordmark />
        </Link>

        <nav aria-label="Primary" className="hidden lg:block">
          <ul className="flex items-center gap-7">
            {MARKETING_NAV_LINKS.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="text-body text-gray-dark hover:text-black focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <Link
            href="/sign-in"
            className="text-body text-gray-dark hover:text-black focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
          >
            Sign in
          </Link>
          <Pill href="/contact" variant="black" size="sm" withArrow>
            Request access
          </Pill>
        </div>

        <button
          type="button"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
          aria-controls={drawerId}
          onClick={() => {
            setMobileOpen((v) => !v);
          }}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-black hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black lg:hidden"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      <div
        id={drawerId}
        hidden={!mobileOpen}
        className="border-t border-black/5 bg-white lg:hidden"
      >
        <nav aria-label="Mobile primary" className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <ul className="flex flex-col gap-1">
            {MARKETING_NAV_LINKS.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  onClick={() => {
                    setMobileOpen(false);
                  }}
                  className="text-body text-gray-dark hover:bg-gray-light/50 block rounded-md px-3 py-2 hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                >
                  {label}
                </Link>
              </li>
            ))}
            <li className="mt-2 border-t border-black/5 pt-3">
              <Link
                href="/sign-in"
                onClick={() => {
                  setMobileOpen(false);
                }}
                className="text-body text-gray-dark hover:bg-gray-light/50 block rounded-md px-3 py-2 hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
              >
                Sign in
              </Link>
            </li>
            <li className="px-3 pt-2">
              <Pill href="/contact" variant="black" size="sm" withArrow className="w-full">
                Request access
              </Pill>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
