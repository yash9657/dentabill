'use client';

import * as React from 'react';

import { reportError } from '../lib/observability/error-reporter.js';

/**
 * Render-time error boundary used to scope failures to a subtree without
 * crashing the whole app.
 *
 * The App Router's built-in `error.tsx` already catches *route-level*
 * errors (server + client) — it's the right boundary for "the page
 * itself failed." This `<ErrorBoundary>` is for *intra-page* boundaries:
 * a chart that crashes shouldn't kill the surrounding dashboard, an
 * embedded waveform shouldn't take down the marketing landing.
 *
 * On catch:
 *   - Calls `reportError(err, { source: 'errorBoundary' })` so the
 *     incident lands in the observability pipeline.
 *   - Renders the configured fallback (a `ReactNode` or a render
 *     function that receives the error + a reset callback).
 *
 * Reset behavior: clicking "Try again" in the fallback clears the
 * boundary's error state and re-renders the children. Useful for
 * transient failures (network blip, race); idempotent failures will
 * loop, which surfaces them clearly.
 *
 * Class component because hooks can't catch render errors (componentDidCatch
 * has no functional-component equivalent in React 19).
 */
export type ErrorBoundaryFallback =
  | React.ReactNode
  | ((args: { readonly error: Error; readonly reset: () => void }) => React.ReactNode);

export interface ErrorBoundaryProps {
  readonly children: React.ReactNode;
  readonly fallback: ErrorBoundaryFallback;
  /** Called after the error has been reported, in case callers want to chain side effects. */
  readonly onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    reportError(error, { source: 'errorBoundary' });
    this.props.onError?.(error, info);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): React.ReactNode {
    const { error } = this.state;
    if (error) {
      const { fallback } = this.props;
      if (typeof fallback === 'function') {
        return fallback({ error, reset: this.reset });
      }
      return fallback;
    }
    return this.props.children;
  }
}
