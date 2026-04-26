'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

/**
 * `<DashboardBreadcrumbs>` — derives a breadcrumb trail from the
 * current pathname.
 *
 * Splits the pathname after `/dashboard` and humanises each segment
 * (`claims-import` → "Claims import", `[id]`-style cuids passed
 * through unchanged because the consumer page can override with a
 * resolved label by setting `data-breadcrumb-label` on the page or
 * by passing a `labels` map prop).
 *
 * Why a client component: `usePathname()` is the canonical Next.js
 * App Router hook for this. The breadcrumb is not data-heavy enough
 * to justify shipping a parallel server-side derivation through
 * `headers()`-based request inspection.
 *
 * Keeps the `<nav aria-label="Breadcrumb">` semantics axe-core
 * expects, with an `<ol>` of links. The current page is the last
 * item and is rendered as `aria-current="page"` plain text rather
 * than a self-link.
 */
export interface DashboardBreadcrumbsProps {
  readonly labels?: Readonly<Record<string, string>>;
}

const ROOT_LABEL = 'Dashboard';

function humaniseSegment(segment: string, labels?: Readonly<Record<string, string>>): string {
  const override = labels?.[segment];
  if (override) return override;
  return segment.replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

export function DashboardBreadcrumbs({
  labels,
}: DashboardBreadcrumbsProps): React.ReactElement | null {
  const pathname = usePathname();
  if (!pathname.startsWith('/dashboard')) return null;

  const trail = pathname
    .replace(/^\/dashboard\/?/, '')
    .split('/')
    .filter(Boolean);

  const items: { readonly href: string; readonly label: string }[] = [
    { href: '/dashboard', label: ROOT_LABEL },
    ...trail.map((segment, index) => ({
      href: `/dashboard/${trail.slice(0, index + 1).join('/')}`,
      label: humaniseSegment(segment, labels),
    })),
  ];

  return (
    <nav aria-label="Breadcrumb" className="text-caption text-gray-warm">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={item.href} className="flex items-center gap-1">
              {index > 0 ? (
                <ChevronRight className="h-3.5 w-3.5 text-black/30" aria-hidden />
              ) : null}
              {isLast ? (
                <span aria-current="page" className="text-black">
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="hover:text-black focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
