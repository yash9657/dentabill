import { NextResponse, type NextRequest } from 'next/server';

import { OnboardingFormSchema } from '../../../lib/onboarding-schema.js';
import { recordHit, type RateLimitConfig } from '../../../lib/rate-limit-memory.js';

/**
 * `POST /v1/onboarding` — same-origin onboarding sink.
 *
 * Validates the body against the shared Zod schema and acks 204 on
 * success. Rate-limits per source IP at 10 attempts per hour so a
 * misbehaving client cannot hammer the route.
 *
 * What it does NOT do, deliberately:
 *
 *   - Write to the DB. The web edge has no DB credentials, and the
 *     real Organization + User write lives in `apps/api` — landing
 *     with the auth-middleware + claims router work in P2-T37+.
 *   - Verify Clerk session. Same reason: real auth-aware writes go
 *     through the API. The route exists today so the form has a
 *     real network round-trip target and the e2e suite can assert
 *     the post-submit redirect.
 *
 * On success we log a structured stderr line with the validated
 * payload so the operator running locally sees the submission flow
 * end to end. PHI redaction is a no-op here — onboarding fields
 * (practice name, NPI, zip, payer list) are not PHI.
 */
const RATE_LIMIT: RateLimitConfig = { windowMs: 60 * 60 * 1000, max: 10 };

function getClientIp(request: NextRequest): string {
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
        message: `Too many onboarding submissions from this network. Try again in ${String(Math.ceil(limit.retryAfterSeconds / 60))} minutes.`,
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

  const parsed = OnboardingFormSchema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return NextResponse.json(
      { message: firstIssue?.message ?? 'Invalid form submission.' },
      { status: 400 },
    );
  }

  console.error(
    JSON.stringify({
      level: 'info',
      event: 'onboarding-submitted',
      receivedAt: new Date().toISOString(),
      ip,
      payload: parsed.data,
    }),
  );

  return new NextResponse(null, { status: 204 });
}
