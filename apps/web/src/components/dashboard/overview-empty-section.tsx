import { Pill } from '@dentabill/ui';
import { ArrowUpRight, FileText, PhoneCall } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

export interface OverviewEmptySectionProps {
  readonly eyebrow: string;
  readonly heading: string;
  readonly body: string;
  readonly ctaLabel: string;
  readonly ctaHref: string;
}
export function OverviewEmptySection({
  eyebrow,
  heading,
  body,
  ctaLabel,
  ctaHref,
}: OverviewEmptySectionProps): React.ReactElement {
  const isCall = eyebrow.toLowerCase().includes('call');
  const Icon = isCall ? PhoneCall : FileText;
  return (
    <section className="overview-panel" aria-label={eyebrow}>
      <header>
        <h2>{eyebrow}</h2>
        <Icon size={17} className="text-gray-warm" aria-hidden />
      </header>
      <div className="overview-panel-body">
        <h3>{heading}</h3>
        <p>{body}</p>
        {isCall ? (
          <Link href={ctaHref} className="text-link">
            {ctaLabel}
            <ArrowUpRight size={16} />
          </Link>
        ) : (
          <Pill href={ctaHref} size="sm" withArrow>
            {ctaLabel}
          </Pill>
        )}
      </div>
    </section>
  );
}
