import './globals.css';

import type { Metadata, Viewport } from 'next';
import { Geist_Mono, Inter, Newsreader } from 'next/font/google';
import * as React from 'react';

import { Providers } from '../components/providers.js';
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
 * Inter covers body and working UI at 400/500/600/700. Newsreader supplies
 * marketing headings at 400/500, including italic emphasis. Geist Mono is
 * reserved for code and technical identifiers. All fonts are self-hosted by
 * next/font and exposed through CSS variables on <html>.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const newsreader = Newsreader({
  subsets: ['latin'],
  variable: '--font-newsreader',
  display: 'swap',
  weight: ['400', '500'],
  style: ['normal', 'italic'],
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
  icons: { icon: '/icon.svg', apple: '/apple-icon.png' },
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
 * The mobile browser chrome uses the same warm ivory as the public site.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#faf8f1',
  colorScheme: 'light',
};

export default async function RootLayout({
  children,
}: {
  readonly children: React.ReactNode;
}): Promise<React.ReactElement> {
  const requestId = await getServerRequestId();
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} ${newsreader.variable}`}
      suppressHydrationWarning
    >
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
      {/*
       * `suppressHydrationWarning` on <body>: browser extensions
       * (ColorZilla's `cz-shortcut-listen`, Grammarly's `data-gr-*`,
       * Dark Reader's CSS attrs, etc.) inject attributes between SSR
       * and hydration. They don't affect React's tree — only the
       * top-level html/body elements — and React's warning would
       * otherwise surface in dev for any user with these extensions
       * installed. The flag does not hide warnings for our own code
       * because it doesn't propagate to children.
       */}
      <body className="bg-white text-black antialiased" suppressHydrationWarning>
        <WebVitalsReporter />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
