import './globals.css';

import type { Metadata, Viewport } from 'next';
import { Geist_Mono, Inter } from 'next/font/google';
import * as React from 'react';

import { WebVitalsReporter } from '../components/web-vitals-reporter.js';
import { getServerRequestId, REQUEST_ID_META_NAME } from '../lib/observability/request-id.js';

/**
 * Root layout for every route in `apps/web` — both the unauthenticated
 * marketing site and the authenticated `/dashboard` shell.
 *
 * **Fonts.** next/font/google self-hosts the woff2 files (no third-party
 * runtime fetch — relevant for both performance and our CSP, which will
 * not list fonts.gstatic.com once P2-T6 lands). `display: 'swap'` shows
 * fallback text immediately instead of waiting for the variable font,
 * keeping LCP under the 2.5s budget from ADR-020.
 *
 * `Inter` is loaded as a single variable font covering the weight range
 * 100–900; we use 200 (display hero), 300 (display sections), 400 (body),
 * 500 (UI/buttons), and 700 (the rare uppercase CTA). `Geist_Mono` covers
 * code blocks; loaded with normal + 500 weights.
 *
 * The CSS variables `--font-inter` and `--font-geist-mono` are applied to
 * `<html>` via `className`. `globals.css` aliases `--font-inter-display`
 * onto `--font-inter` so our token (`family.display` →
 * `var(--font-inter-display)`) resolves to the same loaded variable font
 * without doubling the download.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  weight: ['200', '300', '400', '500', '700'],
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
  weight: ['400', '500'],
});

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'DentaBill — AI voice agent for dental insurance billing',
    template: '%s · DentaBill',
  },
  description:
    'DentaBill calls dental insurance payers, navigates IVRs, and returns structured claim status to your billing team — so your front desk stops waiting on hold.',
  applicationName: 'DentaBill',
  authors: [{ name: 'DentaBill' }],
  keywords: [
    'dental billing',
    'insurance claim follow-up',
    'AI voice agent',
    'dental practice management',
    'claim denial recovery',
  ],
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
  openGraph: {
    type: 'website',
    siteName: 'DentaBill',
    title: 'DentaBill — AI voice agent for dental insurance billing',
    description:
      'Calls payers, navigates IVRs, returns structured claim status. Your front desk stops waiting on hold.',
    url: siteUrl,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DentaBill — AI voice agent for dental insurance billing',
    description:
      'Calls payers, navigates IVRs, returns structured claim status. Your front desk stops waiting on hold.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  alternates: {
    canonical: '/',
  },
};

/**
 * `viewport` is a top-level export per Next.js 15. `themeColor` is white
 * (the achromatic system per ADR-013); the mobile browser chrome blends
 * into the page background.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ffffff',
  colorScheme: 'light',
};

export default async function RootLayout({
  children,
}: {
  readonly children: React.ReactNode;
}): Promise<React.ReactElement> {
  const requestId = await getServerRequestId();
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable}`}>
      <head>
        {/*
         * Embed the per-request id so client-side code can read it via
         * `getClientRequestId()` (lib/observability/request-id.ts) and
         * propagate it on every fetch as `x-request-id`. This makes
         * browser logs, server logs, and downstream traces correlate
         * to the same id.
         */}
        <meta name={REQUEST_ID_META_NAME} content={requestId} />
      </head>
      <body className="bg-white text-black antialiased">
        <WebVitalsReporter />
        {children}
      </body>
    </html>
  );
}
