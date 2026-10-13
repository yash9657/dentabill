import {
  type EndCallInput,
  EndCallInputSchema,
  type RetellEvent,
  type StartCallInput,
  StartCallInputSchema,
  type StartCallResult,
} from './events.js';
import type { RetellEventListener, RetellPort } from './port.js';

/**
 * Internal narrow shape of the `retell-sdk` default export. We declare
 * exactly the methods we depend on so a minor SDK version bump that
 * adds new methods (or renames internal types) doesn't ripple into
 * this package — only `createPhoneCall` and `stop` are load-bearing.
 */
interface RetellLikeClient {
  readonly call: {
    createPhoneCall(
      body: {
        readonly from_number: string;
        readonly to_number: string;
        readonly idempotency_key: string;
        readonly override_agent_id?: string;
        readonly metadata?: unknown;
        readonly retell_llm_dynamic_variables?: Record<string, unknown>;
      },
      options: { readonly maxRetries: number; readonly timeout: number },
    ): Promise<{ readonly call_id: string }>;
    stop(
      callId: string,
      options: { readonly maxRetries: number; readonly timeout: number },
    ): Promise<void>;
  };
}

export type RetellCtor = new (config: { apiKey: string }) => RetellLikeClient;

export type RetellLoader = () => Promise<RetellCtor>;

/**
 * `LiveRetell` (ADR-033) — production adapter wrapping `retell-sdk`.
 *
 * The only adapter that touches the network. **Lazy-loads `retell-sdk`**
 * via `await import()` so importing the `@dentabill/payer-ivr` index
 * does NOT pull the SDK into dev / test bundles where the API key is
 * absent — matches the `hasClerkKeys` pattern from ADR-024 / ADR-030.
 *
 * Subscription semantics: in production the call worker (`apps/call-
 * worker`) and webhook receiver (`apps/api`) run in separate processes,
 * so the same `LiveRetell` instance is never both the producer and the
 * consumer of events. The webhook route writes `CallEvent` rows into
 * Postgres and the worker observes DB state. `subscribe` here is
 * therefore a same-process registry — used by tests that exercise both
 * sides in one process. Production cross-process delivery flows
 * through the database, not through this listener registry.
 */
export interface LiveRetellOptions {
  /** Retell API key. Must be present. Use `createRetellPort` for env-gated selection. */
  readonly apiKey: string;
  /**
   * Override the SDK loader (testing seam). Returns the Retell client
   * constructor. Defaults to dynamic `import('retell-sdk')`.
   */
  readonly retellLoader?: RetellLoader;
  /** Override the clock — used for `queuedAt` timestamps. */
  readonly clock?: () => Date;
}

export class LiveRetell implements RetellPort {
  readonly #apiKey: string;
  readonly #retellLoader: RetellLoader;
  readonly #clock: () => Date;
  readonly #listeners = new Map<string, Set<RetellEventListener>>();
  #client?: RetellLikeClient;

  constructor(options: LiveRetellOptions) {
    if (options.apiKey.length === 0) {
      throw new Error('LiveRetell requires a non-empty apiKey');
    }
    this.#apiKey = options.apiKey;
    this.#retellLoader =
      options.retellLoader ??
      ((): Promise<RetellCtor> =>
        import('retell-sdk').then((m) => m.default as unknown as RetellCtor));
    this.#clock = options.clock ?? ((): Date => new Date());
  }

  async startCall(input: StartCallInput): Promise<StartCallResult> {
    const validation = StartCallInputSchema.safeParse(input);
    if (!validation.success) throw validation.error;
    if (!/^[A-Za-z0-9_-]{5,255}$/.test(input.idempotencyKey)) {
      throw new Error(
        'Retell idempotency key must be 5–255 ASCII letters, digits, underscores, or hyphens.',
      );
    }
    const client = await this.#getClient();
    const queuedAt = this.#clock();
    // Current Create Phone Call docs define a one-hour idempotency window.
    // SDK 5.16.0 serializes this body field although its types predate it.
    // Metadata alone is correlation, not provider-enforced idempotency.
    // https://docs.retellai.com/api-references/create-phone-call
    const response = await client.call.createPhoneCall(
      {
        from_number: input.fromNumberE164,
        to_number: input.toNumberE164,
        idempotency_key: input.idempotencyKey,
        override_agent_id: input.agentId,
        metadata: {
          dentabill_intent_id: input.idempotencyKey,
          idempotencyKey: input.idempotencyKey,
          payerCode: input.payerCode,
        },
        // Retell substitutes `{{var}}` placeholders in the agent prompt
        // from this dictionary. Phase 3 prompts (packages/payer-ivr/agents/*)
        // reference exactly these four keys.
        retell_llm_dynamic_variables: {
          practice_name: input.agentMetadata.practiceName,
          provider_npi: input.agentMetadata.providerNpi,
          subscriber_id: input.agentMetadata.subscriberId,
          date_of_service: input.agentMetadata.dateOfService,
        },
      },
      // A timeout can follow successful creation. The durable intent owner
      // must reconcile ambiguous outcomes instead of issuing another create.
      { maxRetries: 0, timeout: 30_000 },
    );
    return {
      retellCallId: response.call_id,
      queuedAt: queuedAt.toISOString(),
    };
  }

  async endCall(input: EndCallInput): Promise<void> {
    const validation = EndCallInputSchema.safeParse(input);
    if (!validation.success) throw validation.error;
    const client = await this.#getClient();
    // Stop Call terminates an ongoing call; Delete Call removes its data.
    // https://docs.retellai.com/api-references/stop-call
    // Keep failures visible to the caller for reconciliation: neither
    // a timeout nor a generic 4xx proves the call has already ended.
    await client.call.stop(input.retellCallId, { maxRetries: 0, timeout: 10_000 });
  }

  subscribe(retellCallId: string, listener: RetellEventListener): () => void {
    let set = this.#listeners.get(retellCallId);
    if (set === undefined) {
      set = new Set();
      this.#listeners.set(retellCallId, set);
    }
    set.add(listener);
    return () => {
      const current = this.#listeners.get(retellCallId);
      current?.delete(listener);
    };
  }

  /**
   * Same-process event ingestion path. The Fastify webhook route
   * (P3-T17) calls this AFTER HMAC-verifying + parsing the envelope —
   * useful for in-process tests that wire the api + worker together.
   * In production these run in separate processes; this method is then
   * a same-process no-op (no listeners registered).
   */
  ingest(retellCallId: string, event: RetellEvent): void {
    const set = this.#listeners.get(retellCallId);
    if (set === undefined || set.size === 0) return;
    for (const listener of set) {
      void listener(event);
    }
  }

  async #getClient(): Promise<RetellLikeClient> {
    if (this.#client !== undefined) return this.#client;
    const Ctor = await this.#retellLoader();
    // The narrowed `RetellCtor` type already returns `RetellLikeClient`;
    // only the methods we use must remain stable across SDK minor
    // versions.
    this.#client = new Ctor({ apiKey: this.#apiKey });
    return this.#client;
  }
}
