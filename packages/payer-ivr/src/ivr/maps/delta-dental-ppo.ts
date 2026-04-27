import { DTMF_TIMING, type PayerIvrMap } from '../types.js';

/**
 * Delta Dental PPO provider line IVR (1-800-765-6003).
 *
 * Source: PRD §6 (Phase 1 Payer Details).
 *
 * The digit sequence below is a representative skeleton — Delta's PPO
 * provider menu reliably has a "claim status" branch reached via two
 * keypresses after the welcome prompt — but the exact digits MUST be
 * calibrated against a live IVR snapshot before the first production
 * call. P3-T15 verifies the SHAPE works against `FakeRetell`; the
 * runbook (P3-T28) documents the dial-test calibration process.
 */
export const DELTA_DENTAL_PPO_IVR: PayerIvrMap = {
  payerCode: 'DELTA_DENTAL_PPO',
  displayName: 'Delta Dental PPO',
  providerLine: '1-800-765-6003',
  timezone: 'America/Chicago',
  hoursStartHour: 8,
  hoursEndHour: 17,
  estimatedHoldMinutes: 9, // Mid-point of PRD §6's 5–12 min range.
  notes: [
    'Calibration required: digit sequence below is structural — verify against live IVR before first production traffic.',
    'PRD §6 hours: 8 AM – 5 PM CT.',
    'Estimated hold: 5–12 minutes (PRD §6 line 405).',
    'On rep handoff, follow the 7-item information-collection checklist from PRD §6.',
  ],
  steps: [
    {
      type: 'WAIT',
      ms: DTMF_TIMING.POST_CONNECT_MS,
      note: 'Let welcome message play before any DTMF.',
    },
    {
      type: 'DTMF',
      digit: '2',
      waitBefore: 0,
      waitAfter: DTMF_TIMING.INTER_DIGIT_MS,
      note: 'Provider menu — typically option 2 on Delta lines.',
    },
    {
      type: 'DTMF',
      digit: '1',
      waitBefore: 0,
      waitAfter: DTMF_TIMING.INTER_DIGIT_MS,
      note: 'Claim status branch.',
    },
    {
      type: 'WAIT',
      ms: DTMF_TIMING.POST_SPEECH_MS,
      note: 'IVR prompts for NPI before continuing.',
    },
    {
      type: 'COLLECT_VOICE_INPUT',
      fromVar: 'npi',
      waitAfter: DTMF_TIMING.POST_SPEECH_MS,
      note: 'Some Delta menus accept spoken NPI; fallback IVR map sends DTMF digit-by-digit at NPI_DIGIT_MS.',
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
      note: 'ADR-039 hard cap; navigator escalates if breached.',
    },
  ],
};
