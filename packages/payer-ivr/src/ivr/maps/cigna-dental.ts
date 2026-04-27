import { DTMF_TIMING, type PayerIvrMap } from '../types.js';

/**
 * Cigna Dental provider line IVR (1-800-244-6224).
 *
 * Source: PRD §6 (Phase 1 Payer Details).
 *
 * Representative skeleton. Cigna routes provider calls through a multi-
 * step menu that asks for Tax ID + member info before connecting. The
 * digit sequence below MUST be calibrated against a live IVR snapshot
 * before first production traffic; only the structural shape is
 * guaranteed by P3-T15's `FakeRetell` integration test.
 */
export const CIGNA_DENTAL_IVR: PayerIvrMap = {
  payerCode: 'CIGNA_DENTAL',
  displayName: 'Cigna Dental',
  providerLine: '1-800-244-6224',
  timezone: 'America/New_York',
  hoursStartHour: 8,
  hoursEndHour: 18,
  estimatedHoldMinutes: 14, // Mid-point of PRD §6's 8–20 min range.
  notes: [
    'Calibration required: digit sequence below is structural — verify against live IVR before first production traffic.',
    'PRD §6 hours: 8 AM – 6 PM ET.',
    'Estimated hold: 8–20 minutes (PRD §6 line 410). Highest hold variance of the Phase-3 payers.',
    'Cigna typically asks for Group Number in addition to the standard 7-item checklist.',
  ],
  steps: [
    {
      type: 'WAIT',
      ms: DTMF_TIMING.POST_CONNECT_MS,
      note: 'Welcome + language prompt.',
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
      digit: '3',
      waitBefore: 0,
      waitAfter: DTMF_TIMING.INTER_DIGIT_MS,
      note: 'Provider services.',
    },
    {
      type: 'DTMF',
      digit: '2',
      waitBefore: 0,
      waitAfter: DTMF_TIMING.INTER_DIGIT_MS,
      note: 'Claim status branch.',
    },
    {
      type: 'WAIT',
      ms: DTMF_TIMING.POST_SPEECH_MS,
      note: 'IVR asks for Tax ID.',
    },
    {
      type: 'COLLECT_VOICE_INPUT',
      fromVar: 'npi',
      waitAfter: DTMF_TIMING.POST_SPEECH_MS,
      note: 'Cigna accepts NPI in lieu of Tax ID for OON providers.',
    },
    {
      type: 'COLLECT_VOICE_INPUT',
      fromVar: 'subscriberId',
      waitAfter: DTMF_TIMING.POST_SPEECH_MS,
    },
    {
      type: 'WAIT_FOR_HUMAN',
      maxWaitMs: 600_000,
    },
  ],
};
