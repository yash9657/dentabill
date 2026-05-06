/**
 * One-shot runner: executes a single reconciliation pass against the
 * configured DB + Stripe and exits. Used by `pnpm cron:once` (manual
 * ops + the synthetic-monitor in W8).
 */
import { createBillingPort } from '@dentabill/billing';
import { prisma } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';

import { loadBillingWorkerEnv } from './env.js';
import { runReconciliation } from './handler.js';

async function main(): Promise<void> {
  const env = loadBillingWorkerEnv();
  const logger = createLogger({ base: { service: 'billing-worker', env: env.NODE_ENV } });
  const { billing, mode } = await createBillingPort({
    stripeApiKey: env.STRIPE_API_KEY,
    enabled: env.STRIPE_METERED_BILLING_ENABLED,
  });
  logger.info({ mode, enabled: env.STRIPE_METERED_BILLING_ENABLED }, 'billing-worker starting');
  await prisma.$connect();
  try {
    const result = await runReconciliation({ logger, prisma, billing, env });
    logger.info({ ...result }, 'billing-worker reconciliation complete');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err: unknown) => {
  const logger = createLogger({ base: { service: 'billing-worker' } });
  logger.error({ err }, 'billing-worker fatal');
  process.exit(1);
});
