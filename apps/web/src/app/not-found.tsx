import { Pill, SectionDisplay } from '@dentabill/ui';
import * as React from 'react';

/**
 * 404 page rendered for any unmatched route. Server Component — no
 * client interactivity needed.
 *
 * Per `metadata.robots.noindex`, search engines should not index 404s.
 * Next.js sets `noindex` automatically for this file in production.
 */
export default function NotFound(): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <p className="text-caption text-gray-warm font-mono">404</p>
      <SectionDisplay>Page not found.</SectionDisplay>
      <p className="text-body text-gray-dark">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
      <Pill href="/" variant="black" withArrow>
        Back home
      </Pill>
    </main>
  );
}
