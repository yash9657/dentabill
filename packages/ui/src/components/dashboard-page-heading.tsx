import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * DashboardPageHeading — a reusable page heading pattern for dashboard pages.
 *
 * Combines an optional eyebrow caption (uppercase micro, warm-gray), a display
 * title at 28–32px weight 300, and optional description and right-aligned actions.
 * Per DESIGN.md §3 typography hierarchy, reduces hand-rolled dashboard headings.
 *
 * Props:
 *   - `title` (required): the main heading text
 *   - `eyebrow` (optional): uppercase caption above the title (12px micro)
 *   - `description` (optional): body text below the title
 *   - `level` (optional): heading level (h1, h2, h3, default h1)
 *   - `actions` (optional): right-aligned content (buttons, links, etc.)
 *   - `className` (optional): merged with cn()
 *
 * Renders semantic heading element with the configurable level.
 * Composition pattern matches SectionDisplay + HeroDisplay from @dentabill/ui.
 */
export interface DashboardPageHeadingProps extends Omit<
  React.HTMLAttributes<HTMLElement>,
  'title'
> {
  readonly title: React.ReactNode;
  readonly eyebrow?: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly level?: 'h1' | 'h2' | 'h3';
  readonly actions?: React.ReactNode;
}

export const DashboardPageHeading = React.forwardRef<HTMLElement, DashboardPageHeadingProps>(
  function DashboardPageHeading(
    { title, eyebrow, description, level = 'h1', actions, className, ...props },
    ref,
  ) {
    const Heading = level;

    return (
      <header ref={ref} className={cn('flex flex-col gap-4', className)} {...props}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
          <div className="flex max-w-3xl flex-col gap-3">
            {eyebrow ? (
              <p className="text-micro text-gray-warm uppercase tracking-[0.12em]">{eyebrow}</p>
            ) : null}
            <Heading className="font-display text-[28px] font-light leading-[1.14] tracking-[-0.01em] text-black sm:text-[32px]">
              {title}
            </Heading>
            {description ? <p className="text-body text-gray-dark">{description}</p> : null}
          </div>

          {actions ? (
            <div className="flex flex-col items-start gap-2 lg:items-end">{actions}</div>
          ) : null}
        </div>
      </header>
    );
  },
);
