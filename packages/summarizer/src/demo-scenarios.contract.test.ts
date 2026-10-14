import {
  DEMO_SCENARIOS,
  renderTurnText,
  selectDemoScenario,
  type DemoScenario,
} from '@dentabill/payer-ivr';
import { describe, expect, it } from 'vitest';

import { FakeClaude } from './fake.js';
import type { SummarizeInput } from './types.js';

/**
 * Contract test between the demo scenario scripts and the offline summarizer.
 *
 * In demo mode (`DEMO_SUMMARIZER_FALLBACK=true`) there is no model in the
 * loop: `deriveSummaryFromTranscript` is a phrase matcher, so the *wording* of
 * each scripted line is what produces the summary a viewer sees on screen
 * beside the transcript. That makes the scripts load-bearing in a way ordinary
 * fixture text is not — rewording "the claim is approved" to "we've gone ahead
 * and processed that one" silently downgrades the summary to `pending` at 0.61
 * confidence, and nothing else in the suite would notice.
 *
 * These tests run each scripted conversation through the real summarizer and
 * assert the derived summary agrees with the outcome the scenario declares.
 */

function toInput(scenario: DemoScenario): SummarizeInput {
  const base = new Date('2026-08-22T15:00:00.000Z');
  return {
    organizationId: 'org_demo',
    callId: `call_${scenario.id}`,
    payerCode: scenario.payerCode,
    transcriptTurns: scenario.turns.map((turn) => ({
      // The worker maps Retell's `user` onto `representative`; mirror that here
      // so this exercises the same shape the summarizer sees in production.
      role: turn.role === 'user' ? ('representative' as const) : turn.role,
      text: turn.text,
      timestamp: new Date(base.getTime() + turn.atMs),
    })),
    promptVersion: 'v1',
  };
}

const summarizer = new FakeClaude({ deriveWhenUnregistered: true });

describe('demo scenarios ↔ offline summarizer contract', () => {
  it.each(['DELTA_DENTAL_PPO', 'CIGNA_DENTAL', 'METLIFE_DENTAL'])(
    'derives a reviewable pending summary from the rendered %s runtime dialogue',
    async (payerCode) => {
      const scenario = selectDemoScenario(payerCode);
      const input = toInput(scenario);
      const { summary } = await summarizer.summarize({
        ...input,
        transcriptTurns: input.transcriptTurns.map((turn) => ({
          ...turn,
          text: renderTurnText(turn.text, {
            practiceName: 'Synthetic demo practice',
            subscriberId: 'SYNTHETIC-DEMO-SUBSCRIBER-A',
            dateOfService: '2026-10-01',
          }),
        })),
      });
      expect(summary).toMatchObject({
        claimStatus: 'pending',
        nextAction: 'CALL_BACK',
        repName: scenario.outcome.representativeName,
        referenceNumber: scenario.outcome.referenceNumber,
        amountApprovedCents: null,
        denialReason: null,
        denialCode: null,
      });
      expect(summary.notes).toContain('offline summarizer (no model call)');
    },
  );

  it('ships a library with more than one outcome per payer mix', () => {
    expect(DEMO_SCENARIOS.length).toBeGreaterThanOrEqual(4);
    const statuses = new Set(DEMO_SCENARIOS.map((s) => s.outcome.claimStatus));
    // A fleet of demo calls that all resolve the same way is the failure this
    // library exists to prevent.
    expect(statuses.size).toBeGreaterThanOrEqual(3);
  });

  it('gives every scenario a distinct id and reference number', () => {
    const ids = new Set(DEMO_SCENARIOS.map((s) => s.id));
    const refs = new Set(DEMO_SCENARIOS.map((s) => s.outcome.referenceNumber));
    expect(ids.size).toBe(DEMO_SCENARIOS.length);
    expect(refs.size).toBe(DEMO_SCENARIOS.length);
  });

  describe.each(DEMO_SCENARIOS.map((s) => [s.id, s] as const))('%s', (_id, scenario) => {
    it('derives a summary that agrees with the declared outcome', async () => {
      const { summary } = await summarizer.summarize(toInput(scenario));

      const expectedStatus =
        scenario.outcome.claimStatus === 'approved' ? 'paid' : scenario.outcome.claimStatus;
      expect(summary.claimStatus).toBe(expectedStatus);

      const expectedAction =
        scenario.outcome.claimStatus === 'denied'
          ? 'APPEAL'
          : scenario.outcome.claimStatus === 'approved'
            ? 'RESOLVED'
            : 'CALL_BACK';
      expect(summary.nextAction).toBe(expectedAction);
    });

    it('surfaces the rep name, so the script says "this is <Name>"', async () => {
      const { summary } = await summarizer.summarize(toInput(scenario));
      expect(summary.repName).toBe(scenario.outcome.representativeName);
    });

    it('surfaces the reference number the rep reads out', async () => {
      const { summary } = await summarizer.summarize(toInput(scenario));
      expect(summary.referenceNumber).toBe(scenario.outcome.referenceNumber);
    });

    it('carries the denial code when, and only when, the claim is denied', async () => {
      const { summary } = await summarizer.summarize(toInput(scenario));
      if (scenario.outcome.claimStatus === 'denied') {
        expect(summary.denialCode).toBe(scenario.outcome.denialCode);
      } else {
        // The deriver passes '' when no code matched; the schema normalises
        // that absence to null.
        expect(summary.denialCode).toBeNull();
      }
    });

    it('reports the approved amount only on approved claims', async () => {
      const { summary } = await summarizer.summarize(toInput(scenario));
      if (scenario.outcome.claimStatus === 'approved') {
        // Guards the "first dollar figure wins" rule: a conversational amount
        // mentioned earlier in the script would be reported as the amount
        // approved.
        expect(summary.amountApprovedCents).toBe(scenario.outcome.amountApprovedCents);
      } else {
        expect(summary.amountApprovedCents).toBeNull();
      }
    });

    it('keeps outcome keywords mutually exclusive', () => {
      const joined = scenario.turns
        .map((t) => t.text)
        .join(' ')
        .toLowerCase();
      const saysDenied = joined.includes('denied') || joined.includes('denial');
      const saysApproved =
        joined.includes('approved') || joined.includes('paid') || joined.includes('good news');

      switch (scenario.outcome.claimStatus) {
        case 'denied':
          expect(saysDenied).toBe(true);
          expect(saysApproved).toBe(false);
          break;
        case 'approved':
          expect(saysApproved).toBe(true);
          expect(saysDenied).toBe(false);
          break;
        case 'pending':
          expect(saysDenied).toBe(false);
          expect(saysApproved).toBe(false);
          break;
      }
    });
  });
});
