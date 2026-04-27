import { describe, expect, it } from 'vitest';

import { AGENTS_BY_PAYER, AgentPromptSchema } from '../agents/index.js';

import { getIvrMap, IVR_MAPS_BY_PAYER } from './maps/index.js';
import { DTMF_TIMING, IvrStepSchema, PayerIvrMapSchema } from './types.js';

describe('DTMF_TIMING — PRD §6 lock', () => {
  it('matches the rules in PRD §6 verbatim', () => {
    expect(DTMF_TIMING).toEqual({
      POST_CONNECT_MS: 2_500,
      INTER_DIGIT_MS: 1_500,
      POST_SPEECH_MS: 3_000,
      NPI_DIGIT_MS: 800,
    });
  });
});

describe('IvrStepSchema', () => {
  it('accepts each step type', () => {
    expect(() => IvrStepSchema.parse({ type: 'WAIT', ms: 1_000 })).not.toThrow();
    expect(() =>
      IvrStepSchema.parse({ type: 'DTMF', digit: '1', waitBefore: 0, waitAfter: 1_500 }),
    ).not.toThrow();
    expect(() =>
      IvrStepSchema.parse({ type: 'SPEECH', say: 'press one', waitAfter: 0 }),
    ).not.toThrow();
    expect(() => IvrStepSchema.parse({ type: 'WAIT_FOR_HUMAN', maxWaitMs: 600_000 })).not.toThrow();
    expect(() =>
      IvrStepSchema.parse({ type: 'COLLECT_VOICE_INPUT', fromVar: 'memberId', waitAfter: 0 }),
    ).not.toThrow();
  });

  it('rejects multi-character DTMF digits', () => {
    expect(() =>
      IvrStepSchema.parse({ type: 'DTMF', digit: '12', waitBefore: 0, waitAfter: 0 }),
    ).toThrow();
  });

  it('accepts the * and # symbols', () => {
    expect(() =>
      IvrStepSchema.parse({ type: 'DTMF', digit: '*', waitBefore: 0, waitAfter: 0 }),
    ).not.toThrow();
    expect(() =>
      IvrStepSchema.parse({ type: 'DTMF', digit: '#', waitBefore: 0, waitAfter: 0 }),
    ).not.toThrow();
  });

  it('rejects unknown step types', () => {
    expect(() => IvrStepSchema.parse({ type: 'NOPE', ms: 100 })).toThrow();
  });
});

describe('PayerIvrMapSchema — every map is structurally valid', () => {
  it.each(['DELTA_DENTAL_PPO', 'CIGNA_DENTAL', 'METLIFE_DENTAL'] as const)(
    '%s map round-trips through schema',
    (code) => {
      const map = IVR_MAPS_BY_PAYER[code];
      expect(map).toBeDefined();
      expect(() => PayerIvrMapSchema.parse(map)).not.toThrow();
    },
  );

  it('every map declares calibration notes', () => {
    for (const map of Object.values(IVR_MAPS_BY_PAYER)) {
      expect(map.notes.some((n) => n.toLowerCase().includes('calibration'))).toBe(true);
    }
  });

  it('every map ends with WAIT_FOR_HUMAN before timing out', () => {
    for (const [code, map] of Object.entries(IVR_MAPS_BY_PAYER)) {
      const last = map.steps.at(-1);
      expect(last?.type, `${code} must end with WAIT_FOR_HUMAN`).toBe('WAIT_FOR_HUMAN');
    }
  });

  it('every map honours the ADR-039 hold cap', () => {
    for (const map of Object.values(IVR_MAPS_BY_PAYER)) {
      const last = map.steps.at(-1);
      if (last?.type === 'WAIT_FOR_HUMAN') {
        expect(last.maxWaitMs).toBeLessThanOrEqual(600_000);
      }
    }
  });

  it('every map opens with a >= POST_CONNECT_MS WAIT', () => {
    for (const map of Object.values(IVR_MAPS_BY_PAYER)) {
      const first = map.steps[0];
      expect(first?.type).toBe('WAIT');
      if (first?.type === 'WAIT') {
        expect(first.ms).toBeGreaterThanOrEqual(DTMF_TIMING.POST_CONNECT_MS);
      }
    }
  });
});

describe('getIvrMap', () => {
  it('returns the map for a Phase-3 payer', () => {
    expect(getIvrMap('DELTA_DENTAL_PPO')?.payerCode).toBe('DELTA_DENTAL_PPO');
    expect(getIvrMap('CIGNA_DENTAL')?.payerCode).toBe('CIGNA_DENTAL');
    expect(getIvrMap('METLIFE_DENTAL')?.payerCode).toBe('METLIFE_DENTAL');
  });

  it('returns undefined for a payer Phase 3 does not cover', () => {
    expect(getIvrMap('AETNA_DENTAL')).toBeUndefined();
    expect(getIvrMap('UNKNOWN')).toBeUndefined();
  });
});

describe('Agent registry — parity with IVR registry (ADR-032)', () => {
  it('every payer with an IVR map has an agent prompt', () => {
    for (const code of Object.keys(IVR_MAPS_BY_PAYER)) {
      expect(AGENTS_BY_PAYER[code as keyof typeof AGENTS_BY_PAYER]).toBeDefined();
    }
  });

  it('every agent prompt round-trips through schema', () => {
    for (const agent of Object.values(AGENTS_BY_PAYER)) {
      expect(() => AgentPromptSchema.parse(agent)).not.toThrow();
    }
  });

  it('agent ids are unique across payers', () => {
    const ids = Object.values(AGENTS_BY_PAYER).map((a) => a.agentId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every agent prompt mentions the 7-item checklist by including "next steps"', () => {
    for (const agent of Object.values(AGENTS_BY_PAYER)) {
      expect(agent.instructions.toLowerCase()).toContain('next steps');
    }
  });

  it('every agent prompt instructs the model to identify as AI when asked', () => {
    for (const agent of Object.values(AGENTS_BY_PAYER)) {
      expect(agent.persona.toLowerCase()).toContain('ai');
      expect(agent.persona.toLowerCase()).toContain('never claim to be human');
    }
  });
});
