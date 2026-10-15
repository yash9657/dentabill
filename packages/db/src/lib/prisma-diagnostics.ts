import type { Logger } from '@dentabill/logger';
import { Prisma } from '@prisma/client';

type DiagnosticLevel = 'error' | 'warn' | 'info';
interface DiagnosticSource {
  $on(level: DiagnosticLevel, listener: (event: Prisma.LogEvent) => void): unknown;
}

// Prisma's request handler supplies clientMethod as target. Retain only known schema
// names and fixed operations, never arbitrary engine text or a user-supplied suffix.
const operations = [
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
] as const;
const allowedTargets = new Set([
  '$queryRaw',
  '$queryRawUnsafe',
  '$executeRaw',
  '$executeRawUnsafe',
  ...Object.values(Prisma.ModelName).flatMap((model) => {
    const accessor = model.charAt(0).toLowerCase() + model.slice(1);
    return operations.map((operation) => `${accessor}.${operation}`);
  }),
]);

function safeTimestamp(timestamp: Date): string | null {
  if (!(timestamp instanceof Date)) return null;
  // Do not invoke a diagnostic object's custom toJSON/toISOString implementation.
  const milliseconds = Date.prototype.getTime.call(timestamp);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

/** Diagnostic messages can embed query inputs and credentials; field redaction is insufficient. */
export function registerPrismaDiagnostics(
  source: DiagnosticSource,
  log: Pick<Logger, DiagnosticLevel>,
): void {
  for (const level of ['error', 'warn', 'info'] as const) {
    source.$on(level, (event) => {
      log[level](
        {
          prisma: {
            target: allowedTargets.has(event.target) ? event.target : 'unknown',
            timestamp: safeTimestamp(event.timestamp),
          },
        },
        'Prisma diagnostic',
      );
    });
  }
}
