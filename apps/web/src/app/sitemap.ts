import type { MetadataRoute } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

/**
 * /sitemap.xml — only the public marketing routes. The full set
 * (about, pricing, security, privacy, terms, contact, faq, blog) lands
 * across P2-T17 to T26; for now we list only what actually exists so
 * crawlers don't get 404s.
 *
 * `lastModified` is intentionally derived from build time — accurate
 * enough for a marketing site that redeploys on every merge to main.
 * Per-page `lastModified` becomes worth wiring up only once we have
 * MDX-backed posts (P2-T26).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    {
      url: `${siteUrl}/`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${siteUrl}/about`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${siteUrl}/pricing`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${siteUrl}/security`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${siteUrl}/privacy`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${siteUrl}/terms`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${siteUrl}/contact`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    // The remaining marketing routes are committed as `<MarketingPageStub>`
    // pages today (P2-T25 and P2-T26 will replace them with real content).
    // They're listed here so internal links in the chrome don't 404 for
    // crawlers while we're filling them in.
    ...(['faq', 'blog'] as const).map((slug) => ({
      url: `${siteUrl}/${slug}`,
      lastModified,
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    })),
  ];
}
