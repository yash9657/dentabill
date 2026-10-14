import {
  validateTemplateVars,
  type NotifierPort,
  type NotifyInput,
  type NotifyResult,
} from './port.js';
import type { TemplateName, TemplateVars } from './templates/index.js';

/**
 * `FakeResend` — in-memory delivery log used by every Phase-4 test.
 *
 *   - Validates payload types against the template's Zod schema. This
 *     does not screen PHI and these legacy templates are synthetic-only.
 *   - Records every dispatch in `deliveries` for spy-style assertions.
 *   - Returns a deterministic id per call so tests can correlate.
 *
 * The Phase-4.5 LiveResend adapter will reuse the same validation +
 * input shape; tests written against FakeResend are forward-compatible.
 */
export interface FakeDelivery<T extends TemplateName = TemplateName> {
  readonly id: string;
  readonly to: string;
  readonly template: T;
  readonly vars: TemplateVars<T>;
  readonly organizationId?: string;
  readonly deliveredAt: string;
}

export class FakeResend implements NotifierPort {
  readonly #deliveries: FakeDelivery[] = [];
  #counter = 0;
  readonly #clock: () => Date;

  public constructor(opts: { readonly clock?: () => Date } = {}) {
    this.#clock = opts.clock ?? ((): Date => new Date());
  }

  public get deliveries(): readonly FakeDelivery[] {
    return this.#deliveries;
  }

  public async notify<T extends TemplateName>(input: NotifyInput<T>): Promise<NotifyResult> {
    validateTemplateVars(input.template, input.vars);
    this.#counter += 1;
    const id = `fake-resend-${String(this.#counter)}`;
    const deliveredAt = this.#clock().toISOString();
    const delivery: FakeDelivery<T> = {
      id,
      to: input.to,
      template: input.template,
      vars: input.vars,
      ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
      deliveredAt,
    };
    this.#deliveries.push(delivery);
    return Promise.resolve({ id, deliveredAt });
  }

  public reset(): void {
    this.#deliveries.length = 0;
    this.#counter = 0;
  }
}
