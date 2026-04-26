import type { MetadataRoute } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

/**
 * /robots.txt for the marketing surface.
 *
 * Authenticated routes (`/dashboard`, `/sign-in`, `/sign-up`) are denied
 * — they're behind Clerk in production, but we still tell crawlers not to
 * waste budget. Sitemap pointer lets Google + Bing pick up
 * `/sitemap.xml` automatically.
 *
 * `Host` directive (used by Yandex) deliberately omitted — irrelevant
 * for our markets, and adding it later is a one-line change.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/dashboard/', '/sign-in', '/sign-up', '/onboarding', '/api/'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
