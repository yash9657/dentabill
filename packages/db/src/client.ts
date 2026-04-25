import { createLogger } from '@dentabill/logger';
import { PrismaClient } from '@prisma/client';

import { orgScopeWriteExtension } from './middleware/org-scope.js';

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

// Build the base client, then layer the org-scope write extension on top.
// All consumers of `@dentabill/db` see the extended client, so multi-tenant
// writes are guarded everywhere — there is no un-guarded escape hatch.
function buildClient() {
  const base = new PrismaClient({
    log: [
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'info' },
    ],
  });

  base.$on('error', (e) => {
    log.error({ prisma: e }, 'prisma error');
  });
  base.$on('warn', (e) => {
    log.warn({ prisma: e }, 'prisma warn');
  });
  base.$on('info', (e) => {
    log.info({ prisma: e }, 'prisma info');
  });

  return base.$extends(orgScopeWriteExtension);
}

type ExtendedPrisma = ReturnType<typeof buildClient>;

declare global {
  var __dentabillPrisma: ExtendedPrisma | undefined;
}

const isProd = process.env.NODE_ENV === 'production';

export const prisma: ExtendedPrisma = isProd
  ? buildClient()
  : (globalThis.__dentabillPrisma ?? buildClient());

if (!isProd) {
  globalThis.__dentabillPrisma = prisma;
}
