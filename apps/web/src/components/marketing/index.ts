/**
 * Barrel for marketing-only chrome. Imported by the
 * `apps/web/src/app/(marketing)` route group's `layout.tsx` and never
 * by the dashboard shell — these components have brand-marketing
 * styling baked in (achromatic header, multi-column footer) that
 * would feel wrong in the authenticated app.
 */
export { CookieBanner, COOKIE_BANNER_STORAGE_KEY } from './cookie-banner.js';
export { MarketingFooter } from './footer.js';
export { MarketingHeader, MARKETING_NAV_LINKS } from './header.js';
export { NewsletterSignupStub } from './newsletter-signup-stub.js';
export { LegalDoc, type LegalDocProps } from './legal-doc.js';
export { MarketingPageStub, type MarketingPageStubProps } from './page-stub.js';
export { Wordmark, type WordmarkProps } from './wordmark.js';
