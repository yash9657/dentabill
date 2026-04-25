import { createLogger } from '@dentabill/logger';
import { PrismaClient } from '@prisma/client';

/**
 * Singleton Prisma client. Importing `prisma` from `@dentabill/db` is the
 * ONLY sanctioned entry point for direct database access — never instantiate
 * `new PrismaClient()` in application code.
 *
 * For multi-tenant reads, prefer `getOrgScopedDb(orgId)` (P1-T4A) so the
 * `organizationId` filter is applied automatically. For writes, the
 * org-scope middleware (P1-T5) is layered on top of this client and rejects
 * writes that lack `organizationId`.
 *
 * In dev/test we cache the client on `globalThis.__prisma` to survive module
 * reloads under tsx / vitest hot reload. In production we always create a
 * fresh client.
 */

const log = createLogger({ base: { service: 'prisma' } });

declare global {
  var __dentabillPrisma: PrismaClient | undefined;
}

function buildClient(): PrismaClient {
  const client = new PrismaClient({
    log: [
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'info' },
    ],
  });

  client.$on('error', (e) => {
    log.error({ prisma: e }, 'prisma error');
  });
  client.$on('warn', (e) => {
    log.warn({ prisma: e }, 'prisma warn');
  });
  client.$on('info', (e) => {
    log.info({ prisma: e }, 'prisma info');
  });

  return client;
}

const isProd = process.env.NODE_ENV === 'production';

export const prisma: PrismaClient = isProd
  ? buildClient()
  : (globalThis.__dentabillPrisma ?? buildClient());

if (!isProd) {
  globalThis.__dentabillPrisma = prisma;
}
