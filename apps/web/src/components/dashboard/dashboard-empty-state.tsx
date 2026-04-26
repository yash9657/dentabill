import { Pill } from '@dentabill/ui';
import * as React from 'react';

/**
 * `<DashboardEmptyState>` — the canonical "this surface has no data
 * yet" panel for every dashboard route that has not yet been wired
 * to its API endpoint.
 *
 * Three visual zones:
 *
 *   1. Eyebrow + title + body — what this page is for, in the
 *      author's voice.
 *   2. Skeleton preview — shows the *shape* of the eventual data
 *      view (table rows, list rows, charts) so the user can read
 *      what is coming. Pass any composition of <Skeleton/> blocks
 *      from `@dentabill/ui` as `previewChildren`. The preview is
 *      muted with reduced opacity so it reads as a sample, not as
 *      data we are pretending to have.
 *   3. Primary CTA — single Pill, kept achromatic per ADR-013. A
 *      secondary action can be passed via `secondaryCta`; it
 *      renders as a quieter `whiteShadow` pill when provided.
 *
 * Side-stripe / accent-bar treatments are explicitly avoided per
 * Impeccable's design laws — the panel chrome is a hairline edge
 * and the warm-stone shadow, nothing more. No oversized hero
 * illustrations either: the skeleton preview is the illustration,
 * because it doubles as a teaching tool.
 */
export interface DashboardEmptyStateProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  readonly previewChildren: React.ReactNode;
  readonly primaryCta: { readonly label: string; readonly href: string };
  readonly secondaryCta?: { readonly label: string; readonly href: string };
}

export function DashboardEmptyState({
  eyebrow,
  title,
  body,
  previewChildren,
  primaryCta,
  secondaryCta,
}: DashboardEmptyStateProps): React.ReactElement {
  return (
    <section className="flex flex-col gap-6">
      <header className="max-w-3xl">
        <p className="text-caption text-gray-warm mb-2 uppercase tracking-[0.14em]">{eyebrow}</p>
        <h1 className="font-display text-[28px] font-light leading-[1.15] tracking-[-0.01em] text-black sm:text-[32px]">
          {title}
        </h1>
        <p className="text-body text-gray-dark mt-3 max-w-prose">{body}</p>
      </header>

      <div
        aria-hidden
        className="hairline-edge bg-stone-warm/20 pointer-events-none rounded-[20px] p-6 opacity-70 sm:p-8"
      >
        {previewChildren}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Pill href={primaryCta.href} variant="black" size="sm" withArrow>
          {primaryCta.label}
        </Pill>
        {secondaryCta ? (
          <Pill href={secondaryCta.href} variant="whiteShadow" size="sm">
            {secondaryCta.label}
          </Pill>
        ) : null}
      </div>
    </section>
  );
}
