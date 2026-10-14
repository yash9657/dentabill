/** Trusted generated bootstrap; neither source code nor paths come from CLI arguments. */
export function demoWebEntrySource(input: {
  nextModulePath: string;
  appDirectory: string;
  appOrigin: string;
  launchId: string;
}): string {
  return `
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
const options = ${JSON.stringify(input)};
const require = createRequire(import.meta.url);
let app;
let server;
let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(code || 1), 5000);
  timeout.unref();
  const closeServer = server ? new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }) : Promise.resolve();
  await Promise.allSettled([closeServer, app?.close()]);
  clearTimeout(timeout);
  if (process.connected) process.disconnect();
  process.exit(code);
}
function send(message) {
  return new Promise((resolve, reject) => {
    if (!process.connected || !process.send) return reject(new Error());
    process.send(message, error => error ? reject(new Error()) : resolve());
  });
}
process.once('SIGINT', () => { void stop(0); });
process.once('SIGTERM', () => { void stop(0); });
process.once('disconnect', () => { void stop(1); });
try {
  if (!process.connected) throw new Error();
  const origin = new URL(options.appOrigin);
  const hostname = origin.hostname.replace(/^\\[|\\]$/g, '');
  const port = Number(origin.port || '80');
  const next = require(options.nextModulePath);
  app = next({ dev: true, dir: options.appDirectory, hostname, port, quiet: true });
  await app.prepare();
  if (stopping) throw new Error();
  const handler = app.getRequestHandler();
  server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch(() => {
      if (!response.headersSent) response.statusCode = 500;
      response.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: hostname, port, exclusive: true }, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  server.on('error', () => { void stop(1); });
  if (stopping) throw new Error();
  await send({ type: 'demo-web-ready', launchId: options.launchId, appOrigin: options.appOrigin });
} catch {
  await send({ type: 'demo-web-failed', launchId: options.launchId, code: 'DEMO_WEB_START_FAILED' }).catch(() => undefined);
  await stop(1);
}
`;
}
