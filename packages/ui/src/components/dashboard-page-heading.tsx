import * as React from 'react';

import { cn } from '../lib/utils.js';

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
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
          <div className="flex max-w-3xl flex-col gap-2">
            {eyebrow ? (
              <p className="text-micro text-gray-warm uppercase tracking-[0.12em]">{eyebrow}</p>
            ) : null}
            <Heading className="font-body text-[28px] font-semibold leading-[1.14] tracking-[-0.01em] text-black sm:text-[32px]">
              {title}
            </Heading>
            {description ? (
              <p className="text-body-standard text-gray-dark">{description}</p>
            ) : null}
          </div>

          {actions ? (
            <div className="flex flex-col items-start gap-2 lg:items-end">{actions}</div>
          ) : null}
        </div>
      </header>
    );
  },
);
