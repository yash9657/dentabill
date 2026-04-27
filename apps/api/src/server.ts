import { buildServer } from './app.js';
import { initEnv } from './lib/env.js';

/**
 * Main entry point for the Fastify API server.
 * Initializes environment, builds the server, and starts listening.
 */
async function main(): Promise<void> {
  // Initialize environment variables
  const env = initEnv();

  // Build the server
  const fastify = await buildServer();

  // Start listening
  try {
    await fastify.listen({ port: env.PORT, host: '0.0.0.0' });
    const authMode = fastify.auth.hasClerkKeys ? 'clerk' : 'test-header-bypass';
    /* eslint-disable no-console */
    console.log(`Server running on http://0.0.0.0:${String(env.PORT)}`);
    console.log(`  auth mode: ${authMode}`);
    if (authMode === 'test-header-bypass') {
      console.log(
        '  ⚠ Real Clerk JWTs will be rejected. Set CLERK_SECRET_KEY and ' +
          'CLERK_PUBLISHABLE_KEY (or NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) in .env to use real auth.',
      );
    }
    /* eslint-enable no-console */
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
