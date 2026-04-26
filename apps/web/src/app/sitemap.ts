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
  ];
}
