import { NextResponse, type NextRequest } from 'next/server';

import { ContactFormSchema } from '../../../lib/contact-schema.js';
import { recordHit, type RateLimitConfig } from '../../../lib/rate-limit-memory.js';

/**
 * `POST /v1/contact` — same-origin contact form sink.
 *
 * Validates the body against the shared Zod schema (so the same
 * messages surface client-side and server-side), rate-limits per
 * source IP (5 messages per IP per hour), and acks 204 on success.
 *
 * What it does NOT do, deliberately:
 *
 *   - Send email. Resend ingestion lives in `apps/api` once the API
 *     is wired up; until then a successful submission is logged in
 *     a structured form to stdout for the operator to pick up.
 *   - Persist to the database. The web edge has no DB credentials
 *     and is intentionally stateless.
 *   - Set a cookie or any session state.
 *
 * Failure modes return application/json with `{ message }` so the
 * client can surface the message inline. Validation errors collapse
 * the field map into a single message — the client's copy of the
 * Zod schema already renders per-field errors at submit time, so a
 * 400 from the server only fires when the client is bypassed.
 */
const RATE_LIMIT: RateLimitConfig = { windowMs: 60 * 60 * 1000, max: 5 };

function getClientIp(request: NextRequest): string {
  // The CSP middleware doesn't normalise these — pick the first
  // forwarded value if present (deployed behind a proxy), otherwise
  // fall back to the direct connection or a sentinel.
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() ?? 'unknown';
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(request);
  const limit = recordHit(ip, RATE_LIMIT);
  if (!limit.ok) {
    return NextResponse.json(
      {
        message: `Too many submissions from this network. Try again in ${String(Math.ceil(limit.retryAfterSeconds / 60))} minutes.`,
      },
      {
        status: 429,
        headers: { 'retry-after': String(limit.retryAfterSeconds) },
      },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ message: 'Body must be JSON.' }, { status: 400 });
  }

  const parsed = ContactFormSchema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return NextResponse.json(
      { message: firstIssue?.message ?? 'Invalid form submission.' },
      { status: 400 },
    );
  }

  // Structured stderr log — picked up by the runtime logger in
  // production and by the operator's tail in dev. We use console.error
  // because no-console only allows error-level messages on the edge;
  // contact-form submissions are operational events the operator is
  // expected to read, not application errors. PHI redaction is a
  // no-op here since contact-form fields are not PHI.
  console.error(
    JSON.stringify({
      level: 'info',
      event: 'contact-form-submitted',
      receivedAt: new Date().toISOString(),
      ip,
      payload: parsed.data,
    }),
  );

  return new NextResponse(null, { status: 204 });
}

export const runtime = 'edge';
