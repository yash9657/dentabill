import { createServer, type Server } from 'node:http';

import type { Logger } from '@dentabill/logger';

/**
 * Lightweight `/healthz` HTTP probe (port 3010 by default).
 *
 *   - GET  /healthz  → 200 plain text "ok" while the worker is healthy
 *                      and accepting jobs; 503 once SIGTERM has flipped
 *                      the worker into draining mode.
 *   - any other path → 404.
 *
 * Kubernetes / Fly / Railway / GHA-runner-level liveness probes ping
 * `/healthz`; the 503 during drain prevents new traffic from being
 * routed to a worker that is in its shutdown window.
 *
 * No framework — vanilla `node:http`. The worker has no other HTTP
 * surface and a 30-line server is the right cost ceiling.
 */
export interface HealthServerOptions {
  readonly port: number;
  readonly logger: Logger;
}

export interface HealthServerHandle {
  readonly server: Server;
  readonly setDraining: (draining: boolean) => void;
  readonly close: () => Promise<void>;
}

export function startHealthServer({ port, logger }: HealthServerOptions): HealthServerHandle {
  let draining = false;

  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      if (draining) {
        res.statusCode = 503;
        res.setHeader('content-type', 'text/plain');
        res.end('draining');
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain');
      res.end('ok');
      return;
    }
    res.statusCode = 404;
    res.setHeader('content-type', 'text/plain');
    res.end('not found');
  });

  server.listen(port, () => {
    logger.info({ port }, 'call-worker health server listening');
  });

  return {
    server,
    setDraining: (value): void => {
      draining = value;
      logger.info({ draining }, 'call-worker drain state changed');
    },
    close: (): Promise<void> =>
      new Promise((resolve, reject) => {
        server.close((err) => {
          if (err !== undefined) reject(err);
          else resolve();
        });
      }),
  };
}
