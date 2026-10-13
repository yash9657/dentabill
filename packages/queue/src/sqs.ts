import {
  ChangeMessageVisibilityCommand,
  type MessageAttributeValue,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { z } from 'zod';

import { TransportJobIdSchema, type JobDispatcher } from './dispatcher.js';
import {
  CALL_JOB_NAME,
  CallJobDataSchema,
  SUMMARY_JOB_NAME,
  SummaryJobDataSchema,
  type CallJobData,
  type SummaryJobData,
} from './types.js';

/**
 * Amazon SQS job dispatch (ADR-053, AWS deployment).
 *
 * One **standard** queue carries both job kinds. Each message body is a
 * JSON envelope `{ "type": "call.place" | "summary.generate", "data": … }`
 * with optional `transportJobId` for an approved recovery generation,
 * and is consumed by the worker Lambda (`apps/api/src/lambda-worker.ts`),
 * which runs the same processors the inline runtime uses — one attempt
 * per receive, with retries delegated to SQS (visibility timeout + redrive
 * policy) instead of BullMQ's in-Redis backoff.
 *
 * Message attributes duplicate the routing fields (`jobType`,
 * `idempotencyKey`) so they are visible in the console / DLQ redrive
 * tooling without parsing the body. No PHI is placed in attributes.
 *
 * Delays: SQS caps `DelaySeconds` at 900 (15 min). A requested delay is
 * rounded up to whole seconds and clamped to that ceiling; when a clamp
 * happens `onDelayClamped` is told so the caller can log it. Standard
 * queues give no deduplication — duplicate suppression lives in the
 * consumer (claim lease / existing-summary check), keyed on
 * `idempotencyKey`, exactly as in inline mode.
 */

/** Hard SQS limit for per-message `DelaySeconds`. */
export const SQS_MAX_DELAY_SECONDS = 900;

export const SqsJobMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal(CALL_JOB_NAME),
      data: CallJobDataSchema,
      transportJobId: TransportJobIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal(SUMMARY_JOB_NAME),
      data: SummaryJobDataSchema,
      transportJobId: TransportJobIdSchema.optional(),
    })
    .strict(),
]);

export type SqsJobMessage = z.infer<typeof SqsJobMessageSchema>;

/**
 * Parse + validate a message body at the dequeue trust boundary. Throws on
 * malformed JSON or a payload that fails the job schemas.
 */
export function parseSqsJobMessage(body: string): SqsJobMessage {
  return SqsJobMessageSchema.parse(JSON.parse(body) as unknown);
}

/**
 * Convert a millisecond delay to SQS `DelaySeconds`: rounded up, clamped to
 * `[0, SQS_MAX_DELAY_SECONDS]`. Non-finite / negative input → 0.
 */
export function toSqsDelaySeconds(delayMs: number | undefined): number {
  if (delayMs === undefined || !Number.isFinite(delayMs) || delayMs <= 0) return 0;
  return Math.min(SQS_MAX_DELAY_SECONDS, Math.ceil(delayMs / 1000));
}

/** The one SQS operation the dispatcher needs — narrowed so tests can fake it. */
export interface SqsSendClient {
  send(command: SendMessageCommand): Promise<{ MessageId?: string | undefined }>;
}

/** Hard SQS limit for a message's visibility timeout (12 h). */
export const SQS_MAX_VISIBILITY_SECONDS = 43_200;

export interface SqsVisibilityClient {
  send(command: ChangeMessageVisibilityCommand): Promise<unknown>;
}

export interface CreateSqsRetrySchedulerOptions {
  readonly queueUrl: string;
  /** Injected client (tests). Defaults to an `SQSClient` from the standard AWS env. */
  readonly client?: SqsVisibilityClient;
}

/**
 * Consumer-side retry delay. A message the worker reports as failed
 * becomes visible again when its visibility timeout lapses; shortening (or
 * lengthening) that timeout to the job's backoff makes SQS redeliver on
 * the BullMQ schedule instead of after the queue-wide timeout. Clamped to
 * `[0, 43 200]` s. Needs `sqs:ChangeMessageVisibility` on the queue.
 */
export function createSqsRetryScheduler(
  options: CreateSqsRetrySchedulerOptions,
): (receiptHandle: string, delaySeconds: number) => Promise<void> {
  let client: SqsVisibilityClient | undefined = options.client;
  return async (receiptHandle, delaySeconds) => {
    client ??= new SQSClient({});
    const seconds = Math.min(SQS_MAX_VISIBILITY_SECONDS, Math.max(0, Math.ceil(delaySeconds)));
    await client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: options.queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: seconds,
      }),
    );
  };
}

export interface CreateSqsJobDispatcherOptions {
  /** Full queue URL (`JOBS_QUEUE_URL`). */
  readonly queueUrl: string;
  /**
   * Injected client (tests). Defaults to an `SQSClient` created on first
   * dispatch; region and credentials come from the standard AWS env
   * (`AWS_REGION`, the Lambda execution role).
   */
  readonly client?: SqsSendClient;
  /** Called when a requested delay exceeded the 900 s SQS ceiling. Must not throw. */
  readonly onDelayClamped?: (ctx: {
    readonly jobId: string;
    readonly requestedMs: number;
    readonly appliedSeconds: number;
  }) => void;
}

export function createSqsJobDispatcher(options: CreateSqsJobDispatcherOptions): JobDispatcher {
  if (options.queueUrl.trim() === '') throw new Error('sqs dispatcher: queueUrl is required');
  let client: SqsSendClient | undefined = options.client;
  const getClient = (): SqsSendClient => (client ??= new SQSClient({}));

  const send = async (message: SqsJobMessage, delayMs: number | undefined): Promise<string> => {
    const transportJobId = TransportJobIdSchema.optional().parse(message.transportJobId);
    const jobId = message.data.idempotencyKey;
    const delaySeconds = toSqsDelaySeconds(delayMs);
    if (delayMs !== undefined && delayMs > SQS_MAX_DELAY_SECONDS * 1000) {
      options.onDelayClamped?.({ jobId, requestedMs: delayMs, appliedSeconds: delaySeconds });
    }
    const attributes: Record<string, MessageAttributeValue> = {
      jobType: { DataType: 'String', StringValue: message.type },
      idempotencyKey: { DataType: 'String', StringValue: jobId },
    };
    await getClient().send(
      new SendMessageCommand({
        QueueUrl: options.queueUrl,
        MessageBody: JSON.stringify({ ...message, transportJobId }),
        MessageAttributes: attributes,
        ...(delaySeconds > 0 && { DelaySeconds: delaySeconds }),
      }),
    );
    // The job id stays the idempotency key (not the SQS MessageId) so the
    // API's audit rows and responses are identical across dispatch modes.
    return jobId;
  };

  return {
    mode: 'sqs',
    dispatchCall(data: CallJobData, opts): Promise<string> {
      return send(
        {
          type: CALL_JOB_NAME,
          data,
          ...(opts?.transportJobId !== undefined && { transportJobId: opts.transportJobId }),
        },
        opts?.delayMs,
      );
    },
    dispatchSummary(data: SummaryJobData, opts): Promise<string> {
      return send(
        {
          type: SUMMARY_JOB_NAME,
          data,
          ...(opts?.transportJobId !== undefined && { transportJobId: opts.transportJobId }),
        },
        opts?.delayMs,
      );
    },
  };
}
