import type { PayerCode } from '@dentabill/db';

import { CIGNA_DENTAL_AGENT } from './cigna-dental.js';
import { DELTA_DENTAL_PPO_AGENT } from './delta-dental-ppo.js';
import { METLIFE_DENTAL_AGENT } from './metlife-dental.js';
import type { AgentPrompt } from './types.js';

/**
 * Payer code → Retell agent prompt registry (ADR-032). Same payer
 * coverage as `IVR_MAPS_BY_PAYER` — the registries are intentionally
 * decoupled (a single payer can have multiple IVR maps in future,
 * e.g. dental vs vision lines, but agent prompts are per payer).
 */
export const AGENTS_BY_PAYER: Partial<Record<PayerCode, AgentPrompt>> = {
  DELTA_DENTAL_PPO: DELTA_DENTAL_PPO_AGENT,
  CIGNA_DENTAL: CIGNA_DENTAL_AGENT,
  METLIFE_DENTAL: METLIFE_DENTAL_AGENT,
};

export function getAgentPrompt(payerCode: PayerCode): AgentPrompt | undefined {
  return AGENTS_BY_PAYER[payerCode];
}

export { CIGNA_DENTAL_AGENT, DELTA_DENTAL_PPO_AGENT, METLIFE_DENTAL_AGENT };
export { AgentPromptSchema, type AgentPrompt } from './types.js';
