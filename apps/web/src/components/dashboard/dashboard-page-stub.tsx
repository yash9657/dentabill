import * as React from 'react';

/**
 * Transitional placeholder body for dashboard routes that the
 * sidebar links to but whose real content lands later in Phase 2.
 *
 * Lives so the sidebar nav from P2-T33 has working destinations
 * without 404ing during the rollout. Each page that replaces this
 * stub does so by overwriting its `page.tsx`; the stub itself is
 * never imported beyond this single transitional window.
 *
 * The copy is intentionally short and cites the next-task ID so a
 * teammate clicking through the dashboard can see what is on deck.
 */
export interface DashboardPageStubProps {
  readonly title: string;
  readonly nextTaskId: string;
  readonly description: string;
}

export function DashboardPageStub({
  title,
  nextTaskId,
  description,
}: DashboardPageStubProps): React.ReactElement {
  return (
    <section aria-labelledby="page-stub-heading" className="max-w-3xl">
      <h1
        id="page-stub-heading"
        className="font-display mb-3 text-[28px] font-light leading-[1.15] tracking-[-0.01em] text-black sm:text-[32px]"
      >
        {title}
      </h1>
      <p className="text-body text-gray-dark">{description}</p>
      <p className="text-caption text-gray-warm mt-4">Next on this page: {nextTaskId}.</p>
    </section>
  );
}
