import { DTMF_TIMING, type PayerIvrMap } from '../types.js';

/**
 * MetLife Dental provider line IVR (1-800-942-0854).
 *
 * Source: PRD §6 (Phase 1 Payer Details).
 *
 * Representative skeleton. MetLife's provider line opens directly into
 * a benefits/claims menu after language selection. The digit sequence
 * below MUST be calibrated against a live IVR snapshot before first
 * production traffic.
 */
export const METLIFE_DENTAL_IVR: PayerIvrMap = {
  payerCode: 'METLIFE_DENTAL',
  displayName: 'MetLife Dental',
  providerLine: '1-800-942-0854',
  timezone: 'America/New_York',
  hoursStartHour: 8,
  hoursEndHour: 20,
  daysOfWeek: [1, 2, 3, 4, 5],
  estimatedHoldMinutes: 10, // Mid-point of PRD §6's 6–15 min range.
  notes: [
    'Calibration required: digit sequence below is structural — verify against live IVR before first production traffic.',
    'PRD §6 hours: 8 AM – 8 PM ET. Longest evening window of the Phase-3 payers.',
    'Estimated hold: 6–15 minutes (PRD §6 line 415).',
    'MetLife may transfer to a sub-IVR for orthodontic claims; navigator handles via the operator-fallback rule (PRD §6 line 423).',
  ],
  steps: [
    {
      type: 'WAIT',
      ms: DTMF_TIMING.POST_CONNECT_MS,
    },
    {
      type: 'DTMF',
      digit: '1',
      waitBefore: 0,
      waitAfter: DTMF_TIMING.INTER_DIGIT_MS,
      note: 'English.',
    },
    {
      type: 'DTMF',
      digit: '2',
      waitBefore: 0,
      waitAfter: DTMF_TIMING.INTER_DIGIT_MS,
      note: 'Dental claim status.',
    },
    {
      type: 'WAIT',
      ms: DTMF_TIMING.POST_SPEECH_MS,
      note: 'IVR asks for provider tax ID / NPI.',
    },
    {
      type: 'COLLECT_VOICE_INPUT',
      fromVar: 'npi',
      waitAfter: DTMF_TIMING.POST_SPEECH_MS,
    },
    {
      type: 'COLLECT_VOICE_INPUT',
      fromVar: 'subscriberId',
      waitAfter: DTMF_TIMING.POST_SPEECH_MS,
    },
    {
      type: 'COLLECT_VOICE_INPUT',
      fromVar: 'dateOfService',
      waitAfter: DTMF_TIMING.POST_SPEECH_MS,
    },
    {
      type: 'WAIT_FOR_HUMAN',
      maxWaitMs: 600_000,
    },
  ],
};
