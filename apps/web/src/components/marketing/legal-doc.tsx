import * as React from 'react';

/**
 * `<LegalDoc>` — shared chrome for the privacy and terms pages.
 *
 * Both documents share the same shape: an eyebrow + title + lede,
 * an "Effective" date row, and a long-form prose body with section
 * headings. Centralising the layout here keeps the typographic
 * rhythm identical between the two so a reader who comes from
 * `/privacy` to `/terms` does not perceive a stylistic shift, which
 * would feel templated.
 *
 * Body content is whatever JSX the consumer passes in. The doc
 * uses the standard prose width (max-w-2xl) and `space-y-6` between
 * paragraphs, plus visible `<h2>` headings styled to match the
 * site's section-heading role with extra top margin to create
 * section breaks without horizontal rules.
 */
export interface LegalDocProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly lede: string;
  readonly effective: string;
  readonly children: React.ReactNode;
}

export function LegalDoc({
  eyebrow,
  title,
  lede,
  effective,
  children,
}: LegalDocProps): React.ReactElement {
  return (
    <main id="main-content" aria-label={eyebrow}>
      <section className="mx-auto max-w-3xl px-4 pb-10 pt-24 sm:px-6 sm:pt-32 lg:px-8">
        <h1 className="font-display mb-6 text-balance text-[40px] font-normal leading-[1.08] tracking-[-0.02em] text-black sm:text-[52px]">
          {title}
        </h1>
        <p className="text-body-large text-gray-dark max-w-2xl">{lede}</p>
        <p className="text-caption text-gray-warm mt-6">Effective {effective}.</p>
      </section>

      <section className="mx-auto max-w-3xl px-4 pb-32 sm:px-6 lg:px-8">
        <div className="text-body text-gray-dark prose-style [&_h2]:font-display space-y-6 [&_a]:text-black [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:no-underline [&_h2]:mb-3 [&_h2]:mt-12 [&_h2]:text-[24px] [&_h2]:font-medium [&_h2]:leading-[1.2] [&_h2]:text-black [&_li]:my-2 [&_p+ul]:!mt-2 [&_strong]:text-black [&_ul]:list-[disclosure-closed] [&_ul]:pl-6">
          {children}
        </div>
      </section>
    </main>
  );
}
