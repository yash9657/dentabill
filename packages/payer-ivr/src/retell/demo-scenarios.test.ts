import { describe, expect, it } from 'vitest';

import { DEMO_SCENARIOS, renderTurnText, selectDemoScenario } from './demo-scenarios.js';

describe('runtime demo scenario admission', () => {
  it.each(['DELTA_DENTAL_PPO', 'CIGNA_DENTAL', 'METLIFE_DENTAL'])(
    'selects only a neutral, internally timed %s scenario',
    (payerCode) => {
      const scenario = selectDemoScenario(payerCode);
      expect(scenario.payerCode).toBe(payerCode);
      expect(scenario.outcome.claimStatus).toBe('pending');
      expect(scenario.outcome.amountApprovedCents).toBeUndefined();
      expect(scenario.outcome.denialCode).toBeUndefined();
      expect(scenario.durationSeconds * 1_000).toBe(
        Math.max(...scenario.turns.map((turn) => turn.atMs)) + 2_000,
      );
      expect(DEMO_SCENARIOS).toContain(scenario);
    },
  );

  it.each(['OTHER', '', 'DELTA_DENTAL_PPO\n'])(
    'refuses unsupported payer identity without falling back to another payer',
    (payerCode) => {
      expect(() => selectDemoScenario(payerCode)).toThrow('DEMO_PAYER_UNSUPPORTED');
    },
  );

  it('interpolates supplied facts literally in a single pass', () => {
    expect(
      renderTurnText('{{practiceName}} / {{subscriberId}} / {{dateOfService}}', {
        practiceName: 'Synthetic $& practice {{subscriberId}}',
        subscriberId: 'SYNTHETIC-$`-{{dateOfService}}',
        dateOfService: '2026-10-01',
      }),
    ).toBe('Synthetic $& practice {{subscriberId}} / SYNTHETIC-$`-{{dateOfService}} / 2026-10-01');
  });
});
