import pino, { type DestinationStream, type Logger as PinoLogger, type LoggerOptions } from 'pino';

/**
 * @dentabill/logger
 *
 * Structured logger built on pino with PHI-aware redaction. Every backend
 * service must use this — never `console.*` and never a raw pino instance.
 *
 * Redaction applies to a curated list of PHI field names (patient names,
 * DOB, SSN, member IDs, etc.) and standard auth headers. The list is
 * intentionally over-broad: false positives (e.g., redacting a non-PHI
 * `email` field) are acceptable; false negatives are not.
 *
 * pino redact is not deeply recursive — it relies on path patterns. Add
 * paths here when a new logged shape might contain PHI.
 */

export type Logger = PinoLogger;

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface CreateLoggerOptions {
  level?: LogLevel;
  /** Force pretty transport on/off. Defaults to !isProd. Disabled when a stream is provided. */
  pretty?: boolean;
  /** Inject a destination stream (used in tests to capture output). */
  stream?: DestinationStream;
  /** Replace the default base context (`service`, `env`). */
  base?: Record<string, unknown> | null;
}

const PHI_REDACT_PATHS: readonly string[] = [
  // Standard auth — must never appear in logs
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'authorization',
  'cookie',
  '*.password',
  '*.apiKey',
  '*.token',
  '*.secret',
  '*.privateKey',

  // PHI — top-level wildcards
  '*.patientName',
  '*.firstName',
  '*.lastName',
  '*.middleName',
  '*.subscriberName',
  '*.memberName',
  '*.claimantName',
  '*.dob',
  '*.dateOfBirth',
  '*.ssn',
  '*.memberId',
  '*.subscriberId',
  '*.email',
  '*.phoneNumber',
  '*.phone',
  '*.address',
  '*.streetAddress',

  // PHI — common nested under Fastify req.body
  'req.body.patientName',
  'req.body.firstName',
  'req.body.lastName',
  'req.body.dob',
  'req.body.dateOfBirth',
  'req.body.ssn',
  'req.body.memberId',
  'req.body.email',
  'req.body.phoneNumber',
  'req.body.address',
];

function envValue(key: string): string | undefined {
  // Process.env access is undefined-prone; centralize the read.
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[key];
}

export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  const isProd = envValue('NODE_ENV') === 'production';
  const level: LogLevel = opts.level ?? (isProd ? 'info' : 'debug');
  const usePretty = opts.pretty ?? !isProd;

  const baseOptions: LoggerOptions = {
    level,
    redact: {
      paths: [...PHI_REDACT_PATHS],
      censor: '[Redacted]',
      remove: false,
    },
    base: opts.base ?? {
      service: 'dentabill',
      env: envValue('NODE_ENV') ?? 'development',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  if (opts.stream) {
    return pino(baseOptions, opts.stream);
  }

  if (usePretty) {
    return pino({
      ...baseOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          singleLine: false,
          translateTime: 'SYS:HH:MM:ss.l',
        },
      },
    });
  }

  return pino(baseOptions);
}

/** Default logger instance. Prefer creating a scoped logger via `createLogger`. */
export const logger: Logger = createLogger();
