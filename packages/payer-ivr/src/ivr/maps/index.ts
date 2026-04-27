import type { PayerCode } from '@dentabill/db';

import type { PayerIvrMap } from '../types.js';

import { CIGNA_DENTAL_IVR } from './cigna-dental.js';
import { DELTA_DENTAL_PPO_IVR } from './delta-dental-ppo.js';
import { METLIFE_DENTAL_IVR } from './metlife-dental.js';

/**
 * Payer code → IVR map registry. Entries are added per ADR-032 + ADR-033;
 * Phase 3 covers exactly the three Phase-1 payers (PRD §6). New payers
 * land as new files + a new entry, never as branches inside an existing
 * map (per ADR-032 — payer-specific behaviour stays in payer-specific
 * files).
 */
export const IVR_MAPS_BY_PAYER: Partial<Record<PayerCode, PayerIvrMap>> = {
  DELTA_DENTAL_PPO: DELTA_DENTAL_PPO_IVR,
  CIGNA_DENTAL: CIGNA_DENTAL_IVR,
  METLIFE_DENTAL: METLIFE_DENTAL_IVR,
};

export type SupportedCallPayerCode = keyof typeof IVR_MAPS_BY_PAYER;

/**
 * Returns the IVR map for a payer or `undefined` if Phase 3 doesn't
 * support outbound calls for that payer yet (e.g. AETNA_DENTAL ships
 * in Phase 4+). Callers MUST handle `undefined` — the call enqueue
 * route (P3-T16) rejects with a typed `ApiError` rather than enqueuing
 * a job we can't navigate.
 */
export function getIvrMap(payerCode: PayerCode): PayerIvrMap | undefined {
  return IVR_MAPS_BY_PAYER[payerCode];
}

export { CIGNA_DENTAL_IVR, DELTA_DENTAL_PPO_IVR, METLIFE_DENTAL_IVR };
