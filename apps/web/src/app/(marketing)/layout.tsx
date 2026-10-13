import * as React from 'react';

import {
  CookieBanner,
  MarketingFooter,
  MarketingHeader,
} from '../../components/marketing/index.js';

/**
 * Layout for the unauthenticated marketing surface (`/`, `/about`,
 * `/pricing`, `/security`, `/privacy`, `/terms`, `/contact`, `/faq`,
 * `/blog`).
 *
 * Wraps every marketing page in the shared chrome:
 *   - `<MarketingHeader>` — sticky white nav with primary CTA pill.
 *   - The page itself, as the centre column at full width.
 *   - `<MarketingFooter>` — multi-column links + newsletter stub.
 *   - `<CookieBanner>` — bottom-fixed notice (Phase 2 is notice-only;
 *     real consent gating lands when analytics ship in Phase 4/5).
 *
 * Lives in the `(marketing)` route group so the dashboard shell
 * (`/dashboard/**`, P2-T32 onward) can keep its own layout — neither
 * inherits the other's chrome.
 */
export default function MarketingLayout({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="marketing-site flex min-h-screen flex-col">
      <MarketingHeader />
      <div className="marketing-content flex-1">{children}</div>
      <MarketingFooter />
      <CookieBanner />
    </div>
  );
}
