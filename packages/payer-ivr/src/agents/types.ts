import { z } from 'zod';

import { SUPPORTED_PAYER_CODES } from '../payer-codes.js';

/**
 * Per-payer Retell agent prompt (ADR-032).
 *
 * Each prompt is the LLM's instruction set when speaking to a human rep.
 * Prompts include placeholders the call worker substitutes per call:
 *
 *   `{{practice_name}}`    — the calling DentaBill org's display name
 *   `{{provider_npi}}`     — provider NPI on the claim (already passed
 *                            via DTMF; restated for the rep)
 *   `{{subscriber_id}}`    — patient subscriber/member ID
 *   `{{date_of_service}}`  — claim DOS, formatted MM/DD/YYYY
 *
 * The placeholder names match the snake_case keys the worker sends in
 * Retell's `retell_llm_dynamic_variables` payload (see
 * `packages/payer-ivr/src/retell/live.ts`). Retell does literal-string
 * substitution; any mismatch leaks "{{practice_name}}" verbatim to the
 * rep, so the casing is part of the contract.
 */
const PLACEHOLDER_PATTERN = /\{\{([a-z][a-z0-9_]*)\}\}/g;
const ALLOWED_PLACEHOLDERS: ReadonlySet<string> = new Set([
  'practice_name',
  'provider_npi',
  'subscriber_id',
  'date_of_service',
]);

function placeholdersAreSnakeCase(text: string): boolean {
  // Reject any `{{...}}` that isn't an allowed snake_case placeholder.
  // This catches both stray camelCase (`{{practiceName}}`) and typos
  // (`{{provierNpi}}`) at boundary time rather than at first call.
  const matches = text.match(/\{\{[^}]+\}\}/g) ?? [];
  for (const raw of matches) {
    const inner = raw.slice(2, -2).trim();
    if (!ALLOWED_PLACEHOLDERS.has(inner)) return false;
  }
  // And require every match to be in canonical form (no whitespace,
  // single brace pair). PLACEHOLDER_PATTERN enforces that shape.
  PLACEHOLDER_PATTERN.lastIndex = 0;
  for (const m of matches) {
    if (!/^\{\{[a-z][a-z0-9_]*\}\}$/.test(m)) return false;
  }
  return true;
}

const PromptText = z
  .string()
  .min(1)
  .refine(
    placeholdersAreSnakeCase,
    'Prompt may only reference snake_case placeholders from {practice_name, provider_npi, subscriber_id, date_of_service}.',
  );

export const AgentPromptSchema = z.object({
  payerCode: z.enum(SUPPORTED_PAYER_CODES as readonly [string, ...string[]]),
  /** Stable, human-readable identifier — also the suffix of the Retell agent name. */
  agentId: z.string().min(1),
  /** Single-paragraph "voice" — used by Retell as the system persona. */
  persona: PromptText,
  /** Multi-step instruction the LLM follows for THIS call. */
  instructions: PromptText,
  /**
   * First utterance the agent speaks once the call connects (outbound).
   * Without this, Retell waits silently and the rep hangs up after a
   * few seconds of dead air. Substituted with the same dynamic
   * variables as `persona` / `instructions`.
   */
  beginMessage: PromptText,
  /** Closing phrase the LLM uses to terminate the call after collecting info. */
  closingLine: PromptText,
});

export type AgentPrompt = z.infer<typeof AgentPromptSchema>;
