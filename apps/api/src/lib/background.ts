import { waitUntil } from '@vercel/functions';

/**
 * Run `promise` past the end of the current response (ADR-053).
 *
 * On Vercel, `waitUntil` keeps the invocation alive until the promise
 * settles (bounded by the function's maxDuration). Anywhere else there is
 * no request context and `waitUntil` is a no-op — the promise simply keeps
 * running on the long-lived process, which is exactly the fallback we want.
 *
 * Rejections are swallowed here so a background failure can never surface
 * as an unhandled rejection; callers attach their own logging first.
 */
export function runInBackground(promise: Promise<unknown>): void {
  const guarded = promise.then(
    () => undefined,
    () => undefined,
  );
  waitUntil(guarded);
}
