/**
 * AWS Lambda API entry (ADR-053, AWS deployment).
 *
 * The function runs behind the AWS Lambda Web Adapter layer
 * (`AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap`, handler `run.sh`), which
 * starts this file as an ordinary long-lived HTTP server and proxies each
 * invocation to it. With `AWS_LWA_INVOKE_MODE=response_stream`, SSE
 * responses stream through the Lambda Function URL.
 *
 * The adapter's readiness check polls `AWS_LWA_READINESS_CHECK_PATH`
 * (`/v1/healthz` — liveness only, so a slow database never blocks a cold
 * start) on `AWS_LWA_PORT` (8080).
 *
 * Lambda freezes the process as soon as a response completes, so this
 * entry must run with `JOB_DISPATCH_MODE=sqs`: jobs are sent to SQS before
 * the response is returned and nothing is left running in the background.
 */
import { buildServer } from './app.js';
import { initEnv } from './lib/env.js';

async function main(): Promise<void> {
  const env = initEnv();
  if (env.JOB_DISPATCH_MODE === 'inline') {
    // Inline mode relies on work continuing after the response, which a
    // frozen Lambda process cannot do.
    throw new Error('lambda-server: JOB_DISPATCH_MODE=inline is not supported on Lambda; use sqs');
  }
  const server = await buildServer();
  const port = Number(process.env.PORT ?? process.env.AWS_LWA_PORT ?? 8080);
  await server.listen({ host: '0.0.0.0', port });

  const shutdown = (): void => {
    server.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  console.error('lambda-server: fatal boot error', err);
  process.exit(1);
});
