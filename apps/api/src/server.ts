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
    // eslint-disable-next-line no-console
    console.log(`Server running on http://0.0.0.0:${String(env.PORT)}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
