import { DemoAutopilot } from './autopilot.js';
import { FakeRetell } from './fake.js';
import { LiveRetell } from './live.js';
import type { RetellPort } from './port.js';

/**
 * Adapter selection (ADR-033) — call once at process boot.
 *
 *   - `RETELL_API_KEY` set            → `LiveRetell`
 *   - `RETELL_API_KEY` absent / empty → `FakeRetell` (optionally wrapped in `DemoAutopilot`)
 *
 * Same `hasClerkKeys` pattern as ADR-024 / ADR-030: dev / CI without
 * provisioned credentials runs against the in-process fake; production
 * with the env present talks to Retell. The worker handler depends on
 * `RetellPort`, so its production code path is identical regardless of
 * which adapter the factory returned.
 *
 * When `RETELL_API_KEY` is empty and `demoAutopilot === true`, FakeRetell
 * is wrapped in DemoAutopilot to drive demo scenarios (G-B5).
 */
export interface CreateRetellPortInput {
  readonly apiKey?: string | undefined;
  /** Enable demo autopilot scenario driver (GR-B5). Ignored if apiKey is set. */
  readonly demoAutopilot?: boolean | undefined;
}

export interface CreateRetellPortResult {
  readonly port: RetellPort;
  readonly mode: 'live' | 'fake' | 'fake-autopilot';
}

export function createRetellPort(input: CreateRetellPortInput): CreateRetellPortResult {
  const apiKey = input.apiKey?.trim();
  if (apiKey !== undefined && apiKey.length > 0) {
    return { port: new LiveRetell({ apiKey }), mode: 'live' };
  }

  const fakePort = new FakeRetell();

  if (input.demoAutopilot === true) {
    const autopilot = new DemoAutopilot({ port: fakePort, enabled: true });
    return { port: autopilot, mode: 'fake-autopilot' };
  }

  return { port: fakePort, mode: 'fake' };
}
