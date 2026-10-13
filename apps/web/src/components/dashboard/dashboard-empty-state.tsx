import { DashboardPageHeading, Pill } from '@dentabill/ui';
import { FolderOpen } from 'lucide-react';
import * as React from 'react';

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
    <section className="empty-state-panel" aria-label={eyebrow}>
      <FolderOpen size={28} className="text-brand mb-5" strokeWidth={1.5} aria-hidden />
      <DashboardPageHeading title={title} description={body} />
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Pill href={primaryCta.href} size="sm" withArrow>
          {primaryCta.label}
        </Pill>
        {secondaryCta ? (
          <Pill href={secondaryCta.href} variant="whiteShadow" size="sm">
            {secondaryCta.label}
          </Pill>
        ) : null}
      </div>
      <div aria-hidden className="empty-state-preview pointer-events-none">
        {previewChildren}
      </div>
    </section>
  );
}
