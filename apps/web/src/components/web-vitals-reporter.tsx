'use client';

import { useReportWebVitals } from 'next/web-vitals';
import * as React from 'react';

import { attachGlobalErrorListeners } from '../lib/observability/error-reporter.js';
import { reportWebVital } from '../lib/observability/web-vitals.js';

/**
 * Wires the Next.js `useReportWebVitals` hook to our `/v1/metrics/web`
 * reporter and attaches the `window.onerror` / `unhandledrejection`
 * listeners on mount.
 *
 * Renders nothing — purely a side-effect component. Mount once, near the
 * root of the tree, inside the layout (after `<ErrorBoundary>` so this
 * itself is guarded).
 */
export function WebVitalsReporter(): null {
  useReportWebVitals(reportWebVital);

  React.useEffect(() => {
    attachGlobalErrorListeners();
  }, []);

  return null;
}
