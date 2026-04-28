import { createLogger } from '@dentabill/logger';
import { afterEach, describe, expect, it } from 'vitest';

import { startHealthServer, type HealthServerHandle } from './health.js';

const silentLogger = createLogger({
  level: 'fatal',
  pretty: false,
  base: { service: 'call-worker-test' },
});

let active: HealthServerHandle | undefined;

afterEach(async () => {
  if (active !== undefined) {
    await active.close().catch(() => undefined);
    active = undefined;
  }
});

async function fetchStatus(
  port: number,
  path = '/healthz',
): Promise<{ status: number; body: string }> {
  const res = await fetch(`http://127.0.0.1:${String(port)}${path}`);
  return { status: res.status, body: await res.text() };
}

describe('startHealthServer', () => {
  it('returns 200 ok on /healthz when healthy', async () => {
    active = startHealthServer({ port: 0, logger: silentLogger });
    await new Promise<void>((resolve) => active!.server.once('listening', resolve));
    const address = active.server.address();
    if (typeof address !== 'object' || address === null) throw new Error('no address');
    const { status, body } = await fetchStatus(address.port);
    expect(status).toBe(200);
    expect(body).toBe('ok');
  });

  it('flips to 503 once setDraining(true) is called', async () => {
    active = startHealthServer({ port: 0, logger: silentLogger });
    await new Promise<void>((resolve) => active!.server.once('listening', resolve));
    const address = active.server.address();
    if (typeof address !== 'object' || address === null) throw new Error('no address');
    active.setDraining(true);
    const { status, body } = await fetchStatus(address.port);
    expect(status).toBe(503);
    expect(body).toBe('draining');
  });

  it('returns 404 for unknown paths', async () => {
    active = startHealthServer({ port: 0, logger: silentLogger });
    await new Promise<void>((resolve) => active!.server.once('listening', resolve));
    const address = active.server.address();
    if (typeof address !== 'object' || address === null) throw new Error('no address');
    const { status } = await fetchStatus(address.port, '/no-such-path');
    expect(status).toBe(404);
  });
});
