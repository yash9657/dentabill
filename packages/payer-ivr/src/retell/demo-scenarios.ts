/**
 * Synthetic conversation fixtures. Runtime autopilot selects only the neutral
 * payer-matched scenarios; older financial examples remain contract fixtures.
 *
 * ## Two contracts these scripts must honour
 *
 * 1. **Speaker roles follow Retell's convention** — `agent` is the AI placing
 *    the call (us), `user` is the human being spoken to (the payer rep), and
 *    `system` is the IVR. The inline scripts had `agent` and `user` inverted,
 *    which put the payer's lines in our agent's mouth.
 *
 * 2. **The offline summarizer reads these strings literally.**
 *    `deriveSummaryFromTranscript` (packages/summarizer/src/fake.ts) is a
 *    phrase matcher, not a model, so the wording here *is* the summary:
 *
 *      - `denied` / `denial`            → claimStatus denied, nextAction APPEAL
 *      - `approved` / `paid` / `good news` → claimStatus paid, nextAction RESOLVED
 *      - neither                        → claimStatus pending, CALL_BACK, conf 0.61
 *      - first `$n` match               → amountApprovedCents (approved only)
 *      - `REF-…`                        → referenceNumber
 *      - `CO-45` / `PR-96` / `N-130`    → denialCode
 *      - `this is <Name>`               → repName
 *
 *    Consequences worth stating, because they are easy to break by editing a
 *    line to read more naturally:
 *
 *      - A denial script must never contain the words `approved`, `paid` or
 *        `good news` — `denied` is checked first and wins, but the amount
 *        extraction and any future ordering change would flip the outcome.
 *      - An approved script must mention exactly one dollar figure, and it must
 *        be the approved amount. The *first* `$` in the transcript is taken, so
 *        a conversational "you billed $1,800" earlier in the call would be
 *        reported as the amount approved.
 *      - A pending script must avoid every keyword above, or it stops being
 *        pending.
 *
 * Keeping the summary honest against the transcript is the point: on camera the
 * viewer reads both, and a summary contradicting the visible conversation is
 * worse than no summary at all.
 */

/** Transcript roles, per Retell's convention. */
export type DemoTurnRole = 'system' | 'agent' | 'user';

/** One scripted line, scheduled relative to call start. */
export interface DemoTurn {
  /** Milliseconds after call start at which this line is emitted. */
  readonly atMs: number;
  readonly role: DemoTurnRole;
  readonly text: string;
}

/** Structured payload attached to `call.ended`. */
export interface DemoOutcome {
  readonly claimStatus: 'approved' | 'denied' | 'pending';
  readonly representativeName: string;
  readonly referenceNumber: string;
  readonly nextSteps: string;
  readonly denialCode?: string;
  readonly denialReason?: string;
  readonly amountApprovedCents?: number;
}

export interface DemoScenario {
  /** Stable identifier, used in logs and tests. */
  readonly id: string;
  /** Payer this script is written for. */
  readonly payerCode: string;
  readonly turns: readonly DemoTurn[];
  /** Wall-clock duration reported on `call.ended`. */
  readonly durationSeconds: number;
  readonly outcome: DemoOutcome;
}

/**
 * Shared opening: IVR greeting, our agent supplying the subscriber id, the
 * transfer, and hold. `subscriberId` is interpolated by the autopilot.
 *
 * Timings are deliberately not identical across scenarios — see `withJitter`.
 */
function openingTurns(subscriberIdToken: string): readonly DemoTurn[] {
  return [
    {
      atMs: 200,
      role: 'system',
      text: 'Thank you for calling the provider services line. Please say or enter the subscriber ID.',
    },
    {
      atMs: 3_000,
      role: 'agent',
      text: `Subscriber ID ${subscriberIdToken}.`,
    },
    {
      atMs: 5_000,
      role: 'system',
      text: 'For claim status, press 2.',
    },
    {
      atMs: 6_200,
      role: 'agent',
      text: 'Pressing 2 for claim status.',
    },
    {
      atMs: 7_500,
      role: 'system',
      text: 'Connecting you to a representative. Estimated wait time is two minutes.',
    },
    {
      atMs: 9_000,
      role: 'system',
      text: 'Hold music.',
    },
  ];
}

/** Where the rep conversation begins, after the shared opening. */
const REP_START_MS = 16_000;

function t(offsetMs: number, role: DemoTurnRole, text: string): DemoTurn {
  return { atMs: REP_START_MS + offsetMs, role, text };
}

/**
 * The scenario library. Six distinct calls across three payers and three
 * outcomes, so a concurrent fleet reads as six real, different conversations.
 *
 * Amounts, denial codes, rep names and durations all vary deliberately.
 */
const HISTORICAL_DEMO_SCENARIOS: readonly DemoScenario[] = [
  // ── 1. Delta Dental PPO — clean approval, large balance ──────────────────
  {
    id: 'delta-approved-crown',
    payerCode: 'DELTA_DENTAL_PPO',
    durationSeconds: 54,
    turns: [
      ...openingTurns('{{subscriberId}}'),
      t(0, 'user', 'Provider services, this is Denise. Who am I speaking with?'),
      t(
        2_500,
        'agent',
        'This is the billing line for Bright Smile Dental, following up on a claim for date of service {{dateOfService}}.',
      ),
      t(5_500, 'user', 'Let me pull that up. One moment.'),
      t(9_000, 'user', 'I have it here. That claim has been approved.'),
      t(
        12_000,
        'user',
        'The allowed amount is $1,240.00, and it went out in this week payment cycle.',
      ),
      t(15_500, 'agent', 'Could I get a reference number for this call?'),
      t(18_000, 'user', 'Certainly. Your reference is REF-4417-DD.'),
      t(21_000, 'agent', 'Thank you. Is any further documentation needed from our side?'),
      t(23_500, 'user', 'No, nothing further. It is closed out.'),
      t(26_000, 'agent', 'Appreciate your help. Have a good day.'),
    ],
    outcome: {
      claimStatus: 'approved',
      representativeName: 'Denise',
      referenceNumber: 'REF-4417-DD',
      amountApprovedCents: 124_000,
      nextSteps: 'No further action required — payment released this cycle',
    },
  },

  // ── 2. Delta Dental PPO — denied, timely filing ──────────────────────────
  {
    id: 'delta-denied-timely-filing',
    payerCode: 'DELTA_DENTAL_PPO',
    durationSeconds: 61,
    turns: [
      ...openingTurns('{{subscriberId}}'),
      t(0, 'user', 'Thanks for holding, this is Marcus in provider services.'),
      t(
        2_500,
        'agent',
        'Following up on a claim for Bright Smile Dental, date of service {{dateOfService}}.',
      ),
      t(6_000, 'user', 'I see it. That one was denied under code CO-29.'),
      t(9_500, 'agent', 'Can you tell me what CO-29 refers to here?'),
      t(12_000, 'user', 'The timely filing limit was exceeded. We received it past the window.'),
      t(15_500, 'agent', 'Is there an appeal window, and what would you need from us?'),
      t(
        18_500,
        'user',
        'You have 90 days from the remittance date. Send the clearinghouse acknowledgement showing the original submission date.',
      ),
      t(23_000, 'agent', 'Understood. Could I have a reference number?'),
      t(25_500, 'user', 'Reference REF-8823-DD.'),
      t(28_500, 'agent', 'Thank you for the detail, Marcus.'),
    ],
    outcome: {
      claimStatus: 'denied',
      representativeName: 'Marcus',
      referenceNumber: 'REF-8823-DD',
      denialCode: 'CO-29',
      denialReason: 'Timely filing limit exceeded',
      nextSteps:
        'Appeal within 90 days with the clearinghouse acknowledgement proving original submission date',
    },
  },

  // ── 3. Cigna Dental — denied, bundled into another procedure ─────────────
  {
    id: 'cigna-denied-bundled',
    payerCode: 'CIGNA_DENTAL',
    durationSeconds: 47,
    turns: [
      ...openingTurns('{{subscriberId}}'),
      t(0, 'user', 'Cigna provider services, this is Priya.'),
      t(2_500, 'agent', 'Checking status on a claim for date of service {{dateOfService}}.'),
      t(6_000, 'user', 'That claim was denied under CO-97.'),
      t(9_000, 'agent', 'What is the reason behind that code?'),
      t(
        11_500,
        'user',
        'The benefit is considered included in another procedure adjudicated the same day.',
      ),
      t(15_000, 'agent', 'It was a distinct service. Would a narrative support reconsideration?'),
      t(
        18_000,
        'user',
        'Yes. Send a narrative and the chart notes showing it was separate and distinct.',
      ),
      t(21_000, 'agent', 'Reference number, please?'),
      t(23_000, 'user', 'REF-2098-CG.'),
      t(25_500, 'agent', 'Thank you, Priya.'),
    ],
    outcome: {
      claimStatus: 'denied',
      representativeName: 'Priya',
      referenceNumber: 'REF-2098-CG',
      denialCode: 'CO-97',
      denialReason: 'Benefit included in another procedure adjudicated the same day',
      nextSteps: 'Appeal with narrative and chart notes showing a separate, distinct service',
    },
  },

  // ── 4. Cigna Dental — approved at a reduced allowed amount ───────────────
  {
    id: 'cigna-approved-partial',
    payerCode: 'CIGNA_DENTAL',
    durationSeconds: 43,
    turns: [
      ...openingTurns('{{subscriberId}}'),
      t(0, 'user', 'Provider line, this is Andre speaking.'),
      t(2_500, 'agent', 'Status check on a claim, date of service {{dateOfService}}.'),
      t(6_000, 'user', 'That one is approved.'),
      t(9_000, 'user', 'The allowed amount came to $612.50 after the plan discount.'),
      t(12_500, 'agent', 'Has payment been released?'),
      t(15_000, 'user', 'It is scheduled for the next remittance run, this coming Friday.'),
      t(18_000, 'agent', 'May I have a reference number?'),
      t(20_000, 'user', 'REF-5511-CG.'),
      t(22_500, 'agent', 'Thanks very much for your help.'),
    ],
    outcome: {
      claimStatus: 'approved',
      representativeName: 'Andre',
      referenceNumber: 'REF-5511-CG',
      amountApprovedCents: 61_250,
      nextSteps: 'No further action — remittance scheduled Friday',
    },
  },

  // ── 5. MetLife — still in process, needs a callback ──────────────────────
  //
  // Deliberately contains none of the outcome keywords, so the summarizer
  // derives claimStatus pending / nextAction CALL_BACK at 0.61 confidence.
  // That lower confidence is the point: it demonstrates the product routing an
  // uncertain call to human review instead of pretending to be sure.
  {
    id: 'metlife-pending-in-review',
    payerCode: 'METLIFE_DENTAL',
    durationSeconds: 38,
    turns: [
      ...openingTurns('{{subscriberId}}'),
      t(0, 'user', 'MetLife provider services, this is Tanya.'),
      t(2_500, 'agent', 'Following up on a claim for date of service {{dateOfService}}.'),
      t(6_000, 'user', 'That claim is still with our clinical review team.'),
      t(9_500, 'agent', 'Is there an expected completion date?'),
      t(
        12_000,
        'user',
        'They are running about ten business days. Nothing is needed from you yet.',
      ),
      t(16_000, 'agent', 'I will follow up after that window. Reference number?'),
      t(18_500, 'user', 'REF-7734-ML.'),
      t(21_000, 'agent', 'Thank you, Tanya.'),
    ],
    outcome: {
      claimStatus: 'pending',
      representativeName: 'Tanya',
      referenceNumber: 'REF-7734-ML',
      nextSteps: 'Call back after the ten business day clinical review window',
    },
  },

  // ── 6. MetLife — denied, non-covered under the plan ──────────────────────
  {
    id: 'metlife-denied-non-covered',
    payerCode: 'METLIFE_DENTAL',
    durationSeconds: 51,
    turns: [
      ...openingTurns('{{subscriberId}}'),
      t(0, 'user', 'Provider services, this is Elena.'),
      t(2_500, 'agent', 'Claim status check, date of service {{dateOfService}}.'),
      t(6_000, 'user', 'I show a denial on that one, code PR-204.'),
      t(9_500, 'agent', 'What does PR-204 indicate here?'),
      t(
        12_000,
        'user',
        'Not covered under the patient current benefit plan. It falls to patient responsibility.',
      ),
      t(
        16_000,
        'agent',
        'Was an alternate benefit applied, or is the full amount patient liability?',
      ),
      t(19_500, 'user', 'Full amount is patient liability. No alternate benefit on this plan.'),
      t(23_000, 'agent', 'Understood. Reference number, please?'),
      t(25_000, 'user', 'REF-3162-ML.'),
      t(27_500, 'agent', 'Thank you for clarifying, Elena.'),
    ],
    outcome: {
      claimStatus: 'denied',
      representativeName: 'Elena',
      referenceNumber: 'REF-3162-ML',
      denialCode: 'PR-204',
      denialReason: 'Not covered under the current benefit plan — patient responsibility',
      nextSteps: 'Bill the patient; no payer appeal available on this plan',
    },
  },
];

function pendingReviewScenario(
  payerCode: string,
  payerName: string,
  representativeName: string,
  referenceNumber: string,
): DemoScenario {
  return {
    id: `synthetic-${payerCode.toLowerCase()}-pending-review`,
    payerCode,
    durationSeconds: 39,
    turns: [
      {
        atMs: 200,
        role: 'system',
        text: 'Simulated call for demonstration only. No payer has been contacted.',
      },
      {
        atMs: 400,
        role: 'system',
        text: `Welcome to the simulated ${payerName} provider services line. Please enter the subscriber ID.`,
      },
      { atMs: 3_000, role: 'agent', text: 'Subscriber ID {{subscriberId}}.' },
      { atMs: 5_000, role: 'system', text: 'For claim status, press 2.' },
      { atMs: 6_200, role: 'agent', text: 'Simulating key 2 for claim status.' },
      { atMs: 7_500, role: 'system', text: 'Simulating transfer to a representative.' },
      { atMs: 9_000, role: 'system', text: 'Simulated hold. No audio is playing.' },
      t(0, 'user', `Simulated ${payerName} provider services, this is ${representativeName}.`),
      t(2_500, 'agent', 'Calling for {{practiceName}} about date of service {{dateOfService}}.'),
      t(5_500, 'user', 'In this simulated case, the claim is pending review.'),
      t(9_000, 'agent', 'What follow-up should the practice record?'),
      t(
        12_000,
        'user',
        'Follow up in ten business days. No additional documents are requested in this simulated case.',
      ),
      t(15_000, 'agent', 'Please provide the simulated reference number.'),
      t(18_000, 'user', referenceNumber),
      t(21_000, 'agent', 'Thank you. The practice will review this simulated result.'),
    ],
    outcome: {
      claimStatus: 'pending',
      representativeName,
      referenceNumber,
      nextSteps: 'Simulated follow-up in ten business days; review required.',
    },
  };
}

const RUNTIME_DEMO_SCENARIOS: readonly DemoScenario[] = [
  pendingReviewScenario('DELTA_DENTAL_PPO', 'Delta Dental PPO', 'Denise', 'REF-SIM-DELTA-001'),
  pendingReviewScenario('CIGNA_DENTAL', 'Cigna Dental', 'Priya', 'REF-SIM-CIGNA-001'),
  pendingReviewScenario('METLIFE_DENTAL', 'MetLife Dental', 'Tanya', 'REF-SIM-METLIFE-001'),
];

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  ...HISTORICAL_DEMO_SCENARIOS,
  ...RUNTIME_DEMO_SCENARIOS,
];

export function selectDemoScenario(payerCode: string): DemoScenario {
  const scenario = RUNTIME_DEMO_SCENARIOS.find((candidate) => candidate.payerCode === payerCode);
  if (!scenario) throw new Error('DEMO_PAYER_UNSUPPORTED');
  return scenario;
}

/** Substitute the per-call tokens into a scripted line. */
export function renderTurnText(
  text: string,
  vars: {
    readonly practiceName: string;
    readonly subscriberId: string;
    readonly dateOfService: string;
  },
): string {
  return text.replace(
    /\{\{(practiceName|subscriberId|dateOfService)\}\}/g,
    (_match, key: string) => {
      switch (key) {
        case 'practiceName':
          return vars.practiceName;
        case 'subscriberId':
          return vars.subscriberId;
        default:
          return vars.dateOfService;
      }
    },
  );
}
