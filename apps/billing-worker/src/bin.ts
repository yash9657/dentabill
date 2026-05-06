/**
 * Long-running daily cron (Phase 4 — defaults to 02:00 UTC). Currently
 * delegates to the one-shot runner on a setInterval; Phase 5 swaps
 * this for BullMQ repeatable jobs once the cluster topology lands.
 */
import { createBillingPort } from '@dentabill/billing';
import { prisma } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';

import { loadBillingWorkerEnv } from './env.js';
import { runReconciliation } from './handler.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function tick(): Promise<void> {
  const env = loadBillingWorkerEnv();
  const logger = createLogger({ base: { service: 'billing-worker', env: env.NODE_ENV } });
  const { billing, mode } = await createBillingPort({
    stripeApiKey: env.STRIPE_API_KEY,
    enabled: env.STRIPE_METERED_BILLING_ENABLED,
  });
  logger.info({ mode }, 'billing-worker tick start');
  try {
    const result = await runReconciliation({ logger, prisma, billing, env });
    logger.info({ ...result }, 'billing-worker tick complete');
  } catch (err) {
    logger.error({ err }, 'billing-worker tick failed');
  }
}

async function main(): Promise<void> {
  await prisma.$connect();
  await tick();
  setInterval(() => {
    void tick();
  }, ONE_DAY_MS);
}

void main();
