'use client';

import { Button } from '@dentabill/ui';
import Link from 'next/link';
import * as React from 'react';

/**
 * Cookie notice banner. **This is a notice only**, not a consent gate
 * — Phase 2 ships without analytics, so there is nothing to opt out of
 * yet. When analytics or CDN cookies land in Phase 4/5, replace this
 * with a real consent banner that defers script loading until the
 * user accepts.
 *
 * Persistence: dismissal is stored in `localStorage` under
 * `STORAGE_KEY`. SSR-safe — the banner stays visually hidden until
 * after hydration so the markup matches between server and client and
 * no layout shift fires (CLS budget per ADR-020).
 *
 * Accessibility: the dialog uses `role="region"` with `aria-label` so
 * screen readers announce it as a named landmark; the dismiss button
 * is a real `<button>` with explicit text. The banner is positioned
 * `fixed bottom-0 z-50` so it floats above the sticky header (z-40)
 * but doesn't trap focus or block keyboard navigation.
 */
const STORAGE_KEY = 'dentabill:cookie-banner-dismissed';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CookieBannerProps {
  readonly storage?: StorageLike;
}

export function CookieBanner({ storage }: CookieBannerProps = {}): React.ReactElement | null {
  const [hydrated, setHydrated] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(true);

  React.useEffect(() => {
    setHydrated(true);
    try {
      const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
      if (!store) return;
      setDismissed(store.getItem(STORAGE_KEY) === '1');
    } catch {
      // Private mode or storage disabled — show the banner; it's a notice,
      // not a blocker, and the dismiss action will simply not persist.
      setDismissed(false);
    }
  }, [storage]);

  if (!hydrated || dismissed) return null;

  const dismiss = (): void => {
    setDismissed(true);
    try {
      const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
      store?.setItem(STORAGE_KEY, '1');
    } catch {
      // Same rationale as above: dismissal works for the session even
      // when persistence is unavailable.
    }
  };

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="shadow-card border-border-subtle fixed bottom-4 left-1/2 z-50 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border bg-white p-4 sm:p-5"
    >
      <div className="flex gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-caption text-gray-dark text-balance">
          We use cookies to keep you signed in. Read our{' '}
          <Link
            href="/privacy"
            className="text-black underline underline-offset-2 hover:no-underline"
          >
            privacy policy
          </Link>
          .
        </p>
        <Button type="button" size="sm" onClick={dismiss} className="shrink-0 self-center">
          Got it
        </Button>
      </div>
    </div>
  );
}

export const COOKIE_BANNER_STORAGE_KEY = STORAGE_KEY;
