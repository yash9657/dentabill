#!/usr/bin/env tsx
/**
 * Live-call simulator — orchestrates a full call lifecycle for rehearsal and demos.
 *
 * CLI: `pnpm --filter @dentabill/api exec tsx scripts/simulate-live-call.mts --claim <id|auto> [--speed <n>] [--force]`
 *
 * Creates a Call row, replays a scripted event sequence with natural pacing,
 * publishes events via Redis pub/sub, and enqueues the summary job.
 *
 * Flags:
 *   --claim <id|auto>    Target claim ID or 'auto' to pick a PENDING/DENIED claim.
 *   --speed <n>          Pacing multiplier (default 1.0). Use 0.5 for 2x speed.
 *   --force              Skip idempotency check; allow overwriting an in-flight call.
 */

import { PrismaClient, type Claim } from '@dentabill/db';
import { createRedisConnection, createSummariesQueue, SUMMARY_JOB_NAME } from '@dentabill/queue';
import { publishCallEvent } from '../src/lib/call-events-pubsub.js';
import * as dotenv from 'dotenv';

// Load .env if it exists (for local dev)
dotenv.config({ path: new URL('../../.env', import.meta.url).pathname });

const prisma = new PrismaClient();

// ─── CLI argument parsing ─────────────────────────────────────────────────────

interface CliArgs {
  claim: string | null;
  speed: number;
  force: boolean;
}

function parseCLI(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { claim: null, speed: 1.0, force: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--claim' && i + 1 < args.length) {
      result.claim = args[i + 1];
      i++;
    } else if (args[i] === '--speed' && i + 1 < args.length) {
      result.speed = parseFloat(args[i + 1]);
      i++;
    } else if (args[i] === '--force') {
      result.force = true;
    }
  }

  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sleep for ms milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a pseudo-random ID string.
 */
function randomId(): string {
  return Math.random().toString(36).slice(2);
}

/**
 * Pacing helper: return a random delay in [min, max) ms, scaled by multiplier.
 * Multiplier < 1 compresses delays (faster playback); > 1 expands them.
 */
function randomDelay(min: number, max: number, multiplier: number): number {
  const base = Math.random() * (max - min) + min;
  return Math.round(base / multiplier);
}

// ─── Event sequence ───────────────────────────────────────────────────────────

/**
 * Represents one event in the scripted call sequence.
 */
interface CallEventStep {
  type: string;
  delay: number; // ms to wait before emitting
  data?: Record<string, unknown>;
}

/**
 * Generate a realistic call event sequence (~75s).
 * Includes IVR navigation, hold, and rep conversation.
 */
function generateCallEventSequence(speedMultiplier: number): CallEventStep[] {
  return [
    // Call initiates
    { type: 'call.started', delay: 0, data: { initiator: 'agent' } },

    // IVR navigation (3 turns)
    {
      type: 'ivr.prompt',
      delay: randomDelay(1500, 2500, speedMultiplier),
      data: {
        text: 'Welcome to Dental Insurance. Please enter your claim number.',
        audioUrl: null,
      },
    },
    {
      type: 'ivr.dtmf',
      delay: randomDelay(2000, 3000, speedMultiplier),
      data: { digits: '1234567890' },
    },
    {
      type: 'ivr.prompt',
      delay: randomDelay(1000, 2000, speedMultiplier),
      data: { text: 'Thank you. Transferring to an agent.', audioUrl: null },
    },

    // Hold (45-90s)
    {
      type: 'call.hold_start',
      delay: randomDelay(1000, 2000, speedMultiplier),
      data: { duration_ms: randomDelay(45000, 90000, speedMultiplier), music: true },
    },
    {
      type: 'call.hold_end',
      delay: randomDelay(45000, 90000, speedMultiplier),
      data: { actual_duration_ms: randomDelay(45000, 90000, speedMultiplier) },
    },

    // Human reached
    {
      type: 'call.human_reached',
      delay: randomDelay(500, 1500, speedMultiplier),
      data: { rep_name: 'Agent James', queue_depth: 0 },
    },

    // Rep conversation (~12 turns, ~30s)
    {
      type: 'agent.speech',
      delay: randomDelay(1000, 2000, speedMultiplier),
      data: {
        text: 'Hi there, thanks for calling. I found your claim. Can I get the patient date of birth to verify?',
      },
    },
    {
      type: 'caller.speech',
      delay: randomDelay(1500, 3000, speedMultiplier),
      data: { text: '(Patient verifies DOB)' },
    },
    {
      type: 'agent.speech',
      delay: randomDelay(1000, 2500, speedMultiplier),
      data: { text: 'Great. I see this claim was submitted 14 days ago.' },
    },
    {
      type: 'agent.speech',
      delay: randomDelay(500, 1500, speedMultiplier),
      data: { text: 'We are currently reviewing the coverage under your plan.' },
    },
    {
      type: 'caller.speech',
      delay: randomDelay(1500, 2500, speedMultiplier),
      data: { text: 'When can you let me know about the status?' },
    },
    {
      type: 'agent.speech',
      delay: randomDelay(1000, 2000, speedMultiplier),
      data: { text: 'We should have a decision within 5-7 business days.' },
    },
    {
      type: 'agent.speech',
      delay: randomDelay(500, 1500, speedMultiplier),
      data: { text: 'I will note your request and call you back.' },
    },
    {
      type: 'caller.speech',
      delay: randomDelay(1000, 2000, speedMultiplier),
      data: { text: 'Is this the best number to reach me?' },
    },
    {
      type: 'agent.speech',
      delay: randomDelay(1000, 1500, speedMultiplier),
      data: { text: 'Yes, we have it on file. Thanks for calling.' },
    },
    {
      type: 'agent.speech',
      delay: randomDelay(500, 1000, speedMultiplier),
      data: { text: 'Goodbye.' },
    },

    // Call ends
    {
      type: 'call.ended',
      delay: randomDelay(1000, 2000, speedMultiplier),
      data: {
        reason: 'normal_end',
        collectedInfo: {
          claimNumber: 'CLM-123456',
          patientDOB: '1990-05-15',
          claimAmount: 420.0,
          status: 'pending_review',
          estimatedDecision: '5-7 business days',
        },
      },
    },
  ];
}

// ─── Main logic ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseCLI();

  if (!args.claim) {
    console.error('\n❌ Missing --claim argument. Usage:');
    console.error(
      '   pnpm --filter @dentabill/api exec tsx scripts/simulate-live-call.mts --claim <id|auto>',
    );
    process.exit(1);
  }

  console.log('\n🎬 DentaBill Live-Call Simulator');
  console.log('─'.repeat(60));

  // ─── Select claim ─────────────────────────────────────────────────────────

  let claim: Claim | null = null;

  if (args.claim === 'auto') {
    console.log('\n📋 Selecting a claim (auto)...');
    claim = await prisma.claim.findFirst({
      where: {
        status: { in: ['PENDING', 'DENIED', 'NEEDS_INFO'] },
      },
      orderBy: { priority: 'desc' },
    });
    if (!claim) {
      console.error('❌ No suitable claim found. Try running `seed:demo` first.');
      process.exit(1);
    }
    console.log(`   Selected claim: ${claim.id} (${claim.claimNumber}, status: ${claim.status})`);
  } else {
    console.log(`\n📋 Looking up claim: ${args.claim}`);
    claim = await prisma.claim.findUnique({
      where: { id: args.claim },
    });
    if (!claim) {
      console.error(`❌ Claim not found: ${args.claim}`);
      process.exit(1);
    }
    console.log(`   Found: ${claim.claimNumber} (status: ${claim.status})`);
  }

  // ─── Idempotency check ─────────────────────────────────────────────────────

  const existingCall = await prisma.call.findFirst({
    where: {
      claimId: claim.id,
      status: { notIn: ['COMPLETED', 'FAILED'] },
    },
  });

  if (existingCall && !args.force) {
    console.error(
      `\n❌ Call already in flight on this claim (${existingCall.id}). Use --force to override.`,
    );
    process.exit(1);
  }

  if (existingCall) {
    console.log(`\n⚠️  Overwriting in-flight call ${existingCall.id} (--force).`);
  }

  // ─── Redis & queue setup ──────────────────────────────────────────────────

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const redis = createRedisConnection(redisUrl, { lazyConnect: false });
  await redis.ping();

  const summariesQueue = createSummariesQueue({ connection: redis });

  console.log(`\n✅ Redis connected`);

  // ─── Create Call row ──────────────────────────────────────────────────────

  const retellCallId = `demo_${randomId()}`;
  const now = new Date();

  const call = await prisma.call.create({
    data: {
      organizationId: claim.organizationId,
      claimId: claim.id,
      retellCallId,
      retellAgentId: `agent_demo_${randomId()}`,
      status: 'INITIATED',
      startedAt: now,
    },
  });

  console.log(`\n🤖 Created Call: ${call.id}`);
  console.log(`   Retell ID: ${retellCallId}`);

  // ─── Run event sequence ────────────────────────────────────────────────────

  console.log(`\n🎙️  Replaying call events (speed: ${args.speed}x)...`);

  const events = generateCallEventSequence(args.speed);
  let callEndedAt: Date | null = null;
  let collectedInfo: Record<string, unknown> = {};

  // `step.delay` is the pause BEFORE each event, so the event's timestamp is
  // the running total of every delay so far — not the single delay that
  // preceded it. Stamping each event with `start + step.delay` clustered them
  // all within a few hundred ms of the call start in non-monotonic order,
  // which scrambled the transcript (the call detail view sorts by timestamp)
  // and collapsed the computed duration to 0s.
  let elapsedMs = 0;

  for (const step of events) {
    if (step.delay > 0) {
      await sleep(step.delay);
    }

    elapsedMs += step.delay;

    // Wall-clock pacing may be compressed by --speed, but the stored
    // timestamps must describe a plausible real call, so scale back up.
    const eventTimestamp = new Date(now.getTime() + Math.round(elapsedMs * args.speed));

    // Insert CallEvent row
    const callEvent = await prisma.callEvent.create({
      data: {
        callId: call.id,
        eventType: step.type,
        data: step.data || {},
        timestamp: eventTimestamp,
      },
    });

    // Publish via Redis
    await publishCallEvent(redis, {
      type: step.type,
      callEventId: callEvent.id,
      retellCallId,
      timestamp: eventTimestamp.toISOString(),
      data: step.data,
    });

    console.log(`   [${eventTimestamp.toISOString().split('T')[1]}] ${step.type}`);

    // Track call end info
    if (step.type === 'call.ended') {
      callEndedAt = eventTimestamp;
      collectedInfo = (step.data?.collectedInfo as Record<string, unknown>) || {};
    }
  }

  // ─── Update Call status ────────────────────────────────────────────────────

  if (!callEndedAt) {
    console.error('\n❌ Event sequence did not include call.ended');
    process.exit(1);
  }

  const durationSeconds = Math.round((callEndedAt.getTime() - now.getTime()) / 1000);

  const updatedCall = await prisma.call.update({
    where: { id: call.id },
    data: {
      status: 'COMPLETED',
      endedAt: callEndedAt,
      durationSeconds,
      humanReached: true,
      ivrNavigated: true,
      holdTimeSeconds: randomDelay(45, 90, 1.0),
      audioQualityScore: 0.8 + Math.random() * 0.2,
      callCostCents: randomDelay(50, 200, 1.0),
    },
  });

  console.log(`\n✅ Call completed: ${durationSeconds}s`);

  // ─── Enqueue summary job ──────────────────────────────────────────────────

  const idempotencyKey = `demo-call-${call.id}`;
  const jobName = SUMMARY_JOB_NAME;

  await summariesQueue.add(jobName, {
    organizationId: claim.organizationId,
    callId: call.id,
    promptVersion: 'v1',
    idempotencyKey,
  });

  console.log(`\n📤 Enqueued summary job (${jobName})`);
  console.log(`   Job will be picked up by the summary-worker.`);

  // ─── Update claim (for demo clarity) ───────────────────────────────────────

  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      lastCallAt: now,
      status: 'COMPLETED', // Will be refined by the summary job transition
    },
  });

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  await summariesQueue.close();
  redis.disconnect();
  await prisma.$disconnect();

  // ─── Report ───────────────────────────────────────────────────────────────

  console.log(`\n📊 Simulation complete!`);
  console.log('─'.repeat(60));
  console.log(`   Claim: ${claim.claimNumber} (${claim.id})`);
  console.log(`   Call: ${call.id}`);
  console.log(`   Duration: ${durationSeconds}s`);
  console.log(`   Events published: ${events.length}`);
  console.log(`   Summary job queued: yes`);
  console.log('\n🔗 Next: watch the summary-worker process the job, then check the dashboard.');
  console.log(`   Visit: http://localhost:3000/dashboard/calls/${call.id}`);
}

main().catch((err) => {
  console.error('\n❌ Simulation failed:', err);
  process.exit(1);
});
