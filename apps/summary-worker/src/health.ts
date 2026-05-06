import { createServer, type Server } from 'node:http';

import type { Logger } from '@dentabill/logger';

/**
 * `/healthz` probe for the summary-worker. Mirrors the call-worker
 * pattern (200 → 503 once draining). Vanilla `node:http`; no
 * framework needed for a 30-line server.
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
    logger.info({ port }, 'summary-worker health server listening');
  });

  return {
    server,
    setDraining: (value): void => {
      draining = value;
      logger.info({ draining }, 'summary-worker drain state changed');
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
