import { FakeResend } from './fake.js';
import {
  validateTemplateVars,
  type NotifierPort,
  type NotifyInput,
  type NotifyResult,
} from './port.js';
import type { TemplateName } from './templates/index.js';

/**
 * `LiveResend` — Phase 4.5 placeholder.
 *
 * Phase 4 ships only the port + FakeResend. The live adapter (Resend
 * SDK + React-Email templates) lands in Phase 4.5 once the BAA-signed
 * sending domain is verified. This stub throws if instantiated with a
 * non-empty key, surfacing accidental "I thought live email worked"
 * deploys instead of silently dropping notifications.
 */
export interface LiveResendOptions {
  readonly resendApiKey: string;
}

export class LiveResend implements NotifierPort {
  public constructor(options: LiveResendOptions) {
    if (options.resendApiKey.length >= 0) {
      throw new Error(
        'LiveResend is not implemented in Phase 4 — use FakeResend, or wait for Phase 4.5.',
      );
    }
  }

  public notify<T extends TemplateName>(input: NotifyInput<T>): Promise<NotifyResult> {
    validateTemplateVars(input.template, input.vars);
    // Unreachable — the constructor throws first.
    return Promise.reject(new Error('LiveResend.notify is not implemented in Phase 4.'));
  }
}

/**
 * Mirrors `createSummarizerPort` / `createRetellPort`. Empty key →
 * Fake, non-empty → Live. In Phase 4 the LiveResend constructor
 * throws, so callers must keep `RESEND_API_KEY` unset until 4.5.
 */
export interface CreateNotifierPortInput {
  readonly resendApiKey?: string;
}

export interface CreateNotifierPortResult {
  readonly notifier: NotifierPort;
  readonly mode: 'live' | 'fake';
}

export function createNotifierPort(input: CreateNotifierPortInput): CreateNotifierPortResult {
  const key = input.resendApiKey ?? '';
  if (key.length === 0) {
    return { notifier: new FakeResend(), mode: 'fake' };
  }
  return { notifier: new LiveResend({ resendApiKey: key }), mode: 'live' };
}
