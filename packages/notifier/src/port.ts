import { TEMPLATES, type TemplateName, type TemplateVars } from './templates/index.js';

/**
 * `NotifierPort` — port-and-adapters seam for outbound notifications.
 *
 * `notify` accepts a recipient + template name + variables. Implementations
 * MUST validate `vars` against `TEMPLATES[template]` before dispatch — a
 * malformed payload is a programmer error, not a runtime caveat.
 *
 * Phase 4 ships:
 *   - `FakeResend` (./fake.ts) — in-memory delivery log used by every
 *     test. Always selected; no live adapter wired in Phase 4.
 *
 * Phase 4.5 ships:
 *   - `LiveResend` — wraps `resend` SDK + React-Email templates.
 */
export interface NotifyInput<T extends TemplateName = TemplateName> {
  /** Recipient email address. Validated by the adapter (RFC 5322 lite). */
  readonly to: string;
  readonly template: T;
  readonly vars: TemplateVars<T>;
  /** Optional org id for audit/log correlation. Not used by FakeResend. */
  readonly organizationId?: string;
}

export interface NotifyResult {
  readonly id: string;
  readonly deliveredAt: string;
}

export interface NotifierPort {
  notify<T extends TemplateName>(input: NotifyInput<T>): Promise<NotifyResult>;
}

export class NotifierValidationError extends Error {
  public constructor(
    public readonly template: string,
    public readonly issues: readonly { readonly path: string; readonly message: string }[],
  ) {
    super(
      `notifier ${template} payload validation failed: ${issues
        .map((i) => `${i.path}: ${i.message}`)
        .join('; ')}`,
    );
    this.name = 'NotifierValidationError';
  }
}

export function validateTemplateVars<T extends TemplateName>(
  template: T,
  vars: unknown,
): TemplateVars<T> {
  const schema = TEMPLATES[template];
  const parsed = schema.safeParse(vars);
  if (!parsed.success) {
    throw new NotifierValidationError(
      template,
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return parsed.data;
}
