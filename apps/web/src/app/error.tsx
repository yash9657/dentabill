'use client';

import { Button, SectionDisplay } from '@dentabill/ui';
import * as React from 'react';

/**
 * Per Next.js 15 conventions, `error.tsx` is a Client Component (it
 * receives `reset()` to retry the segment). Required props per the App
 * Router contract: `error: Error & { digest?: string }` and
 * `reset: () => void`.
 *
 * We intentionally do NOT render `error.message` to the user — that
 * string can leak server-internal detail (e.g., DB error text) which we
 * never want surfaced. The `digest` is a server-side correlation ID that
 * is safe to show; it lets support look up the original log entry.
 *
 * Real-time error reporting to `/v1/errors` lands in P2-T16
 * (web-observability).
 */
export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}): React.ReactElement {
  React.useEffect(() => {
    // Surface to the dev console; production reporting comes in P2-T16.
    console.error(error);
  }, [error]);

  return (
    <main
      role="alert"
      className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 py-16 text-center"
    >
      <SectionDisplay>Something went wrong.</SectionDisplay>
      <p className="text-body text-gray-dark">
        We&apos;re working on it. Try again in a moment, or refresh the page.
      </p>
      {error.digest ? (
        <p className="text-caption text-gray-warm font-mono">Reference: {error.digest}</p>
      ) : null}
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
