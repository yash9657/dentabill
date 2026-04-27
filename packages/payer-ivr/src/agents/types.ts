import { z } from 'zod';

import { SUPPORTED_PAYER_CODES } from '../payer-codes.js';

/**
 * Per-payer Retell agent prompt (ADR-032).
 *
 * Each prompt is the LLM's instruction set when speaking to a human rep.
 * Prompts include placeholders the call worker substitutes per call:
 *
 *   `{{practiceName}}`     — the calling DentaBill org's display name
 *   `{{providerNpi}}`      — provider NPI on the claim (already passed
 *                            via DTMF; restated for the rep)
 *   `{{subscriberId}}`     — patient subscriber/member ID
 *   `{{dateOfService}}`    — claim DOS, formatted MM/DD/YYYY
 *   `{{claimNumber}}`      — the payer-side claim number if known
 *
 * Placeholders not supplied at runtime are removed (worker policy) so a
 * partial substitution never leaks "{{...}}" verbatim to the rep.
 */
export const AgentPromptSchema = z.object({
  payerCode: z.enum(SUPPORTED_PAYER_CODES as readonly [string, ...string[]]),
  /** Identifier the worker stamps onto `Call.retellAgentId` if no env override is set. */
  agentId: z.string().min(1),
  /** Single-paragraph "voice" — used by Retell as the system persona. */
  persona: z.string().min(1),
  /** Multi-step instruction the LLM follows for THIS call. */
  instructions: z.string().min(1),
  /** Closing phrase the LLM uses to terminate the call after collecting info. */
  closingLine: z.string().min(1),
});

export type AgentPrompt = z.infer<typeof AgentPromptSchema>;
