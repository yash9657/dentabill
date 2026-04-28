import { FakeRetell } from './fake.js';
import { LiveRetell } from './live.js';
import type { RetellPort } from './port.js';

/**
 * Adapter selection (ADR-033) — call once at process boot.
 *
 *   - `RETELL_API_KEY` set            → `LiveRetell`
 *   - `RETELL_API_KEY` absent / empty → `FakeRetell`
 *
 * Same `hasClerkKeys` pattern as ADR-024 / ADR-030: dev / CI without
 * provisioned credentials runs against the in-process fake; production
 * with the env present talks to Retell. The worker handler depends on
 * `RetellPort`, so its production code path is identical regardless of
 * which adapter the factory returned.
 */
export interface CreateRetellPortInput {
  readonly apiKey?: string | undefined;
}

export interface CreateRetellPortResult {
  readonly port: RetellPort;
  readonly mode: 'live' | 'fake';
}

export function createRetellPort(input: CreateRetellPortInput): CreateRetellPortResult {
  const apiKey = input.apiKey?.trim();
  if (apiKey !== undefined && apiKey.length > 0) {
    return { port: new LiveRetell({ apiKey }), mode: 'live' };
  }
  return { port: new FakeRetell(), mode: 'fake' };
}
