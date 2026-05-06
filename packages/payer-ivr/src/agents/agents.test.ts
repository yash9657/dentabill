import { describe, expect, it } from 'vitest';

import { CIGNA_DENTAL_AGENT } from './cigna-dental.js';
import { DELTA_DENTAL_PPO_AGENT } from './delta-dental-ppo.js';
import { METLIFE_DENTAL_AGENT } from './metlife-dental.js';
import { AgentPromptSchema, type AgentPrompt } from './types.js';

import { AGENTS_BY_PAYER, getAgentPrompt } from './index.js';

const ALL: readonly AgentPrompt[] = [
  DELTA_DENTAL_PPO_AGENT,
  CIGNA_DENTAL_AGENT,
  METLIFE_DENTAL_AGENT,
];

describe('AgentPrompt schema (Phase 3 payers)', () => {
  it.each(ALL)('parses %s under AgentPromptSchema', (prompt) => {
    expect(() => AgentPromptSchema.parse(prompt)).not.toThrow();
  });

  it.each(ALL)('declares snake_case placeholders only — %s', (prompt) => {
    // Retell does literal-string substitution; any camelCase or
    // unsupported placeholder name leaks "{{...}}" verbatim to the rep.
    // Regression guard: keep prompts in lockstep with the wire format
    // in `packages/payer-ivr/src/retell/live.ts`.
    const allowed = ['practice_name', 'provider_npi', 'subscriber_id', 'date_of_service'];
    const text = `${prompt.persona}\n${prompt.instructions}\n${prompt.beginMessage}\n${prompt.closingLine}`;
    const matches = text.match(/\{\{[^}]+\}\}/g) ?? [];
    for (const m of matches) {
      const inner = m.slice(2, -2).trim();
      expect(allowed).toContain(inner);
    }
  });

  it('AGENTS_BY_PAYER covers Phase-3 dialable payers', () => {
    expect(getAgentPrompt('DELTA_DENTAL_PPO')).toBe(DELTA_DENTAL_PPO_AGENT);
    expect(getAgentPrompt('CIGNA_DENTAL')).toBe(CIGNA_DENTAL_AGENT);
    expect(getAgentPrompt('METLIFE_DENTAL')).toBe(METLIFE_DENTAL_AGENT);
    expect(Object.keys(AGENTS_BY_PAYER).sort()).toStrictEqual([
      'CIGNA_DENTAL',
      'DELTA_DENTAL_PPO',
      'METLIFE_DENTAL',
    ]);
  });

  it('rejects camelCase placeholders that would silently leak to reps', () => {
    const broken = {
      ...DELTA_DENTAL_PPO_AGENT,
      persona: 'Calling on behalf of {{practiceName}} — should reject.',
    };
    expect(() => AgentPromptSchema.parse(broken)).toThrow(/snake_case/);
  });

  it('rejects unknown placeholder names', () => {
    const broken = {
      ...DELTA_DENTAL_PPO_AGENT,
      instructions: 'Use {{not_a_real_var}} somewhere — should reject.',
    };
    expect(() => AgentPromptSchema.parse(broken)).toThrow(/snake_case/);
  });
});
