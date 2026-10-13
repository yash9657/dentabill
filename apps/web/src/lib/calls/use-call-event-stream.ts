'use client';

import * as React from 'react';

/**
 * `useCallEventStream` — EventSource wrapper for the SSE feed at
 * `GET /v1/calls/:id/events/stream` (P4-T5 / ADR-046).
 *
 * Returns an array of streamed events with `{ id, eventType,
 * timestamp, data }`. Reconnects with exponential backoff (1s → 30s)
 * and starts in `replaying` until the server emits `event:
 * replay-end`. Falls back to polling-style behaviour when the
 * `enabled` flag is off (the parent page renders the existing
 * 5s-poll detail view in that case).
 */
export interface CallStreamEvent {
  readonly id: string;
  readonly eventType: string;
  readonly timestamp: string;
  readonly data: Record<string, unknown>;
}

export type CallStreamStatus = 'idle' | 'connecting' | 'replaying' | 'open' | 'closed';

export interface UseCallEventStreamResult {
  readonly events: readonly CallStreamEvent[];
  readonly status: CallStreamStatus;
  readonly reconnect: () => void;
}

interface UseCallEventStreamOptions {
  readonly callId: string;
  readonly enabled: boolean;
  readonly bearerToken?: string | null;
  readonly baseUrl?: string;
}

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export function useCallEventStream(opts: UseCallEventStreamOptions): UseCallEventStreamResult {
  const { callId, enabled, bearerToken, baseUrl } = opts;
  const [reconnectKey, setReconnectKey] = React.useState(0);
  const scope = React.useMemo(
    () => ({ callId, enabled, bearerToken, baseUrl, reconnectKey }),
    [callId, enabled, bearerToken, baseUrl, reconnectKey],
  );
  const [stream, setStream] = React.useState<{
    scope: typeof scope;
    events: CallStreamEvent[];
    status: CallStreamStatus;
  }>({ scope, events: [], status: 'idle' });

  const reconnect = React.useCallback(() => {
    setReconnectKey((n) => n + 1);
  }, []);

  React.useEffect(() => {
    const { callId, enabled, bearerToken, baseUrl } = scope;
    setStream({ scope, events: [], status: 'idle' });
    const setStatus = (status: CallStreamStatus): void => {
      setStream((prev) => (prev.scope === scope ? { ...prev, status } : prev));
    };
    if (!enabled || callId.length === 0) {
      return;
    }
    let cancelled = false;
    const isCancelled = (): boolean => cancelled;
    let controller = new AbortController();
    let backoff = INITIAL_BACKOFF_MS;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const seen = new Set<string>();

    const run = async (): Promise<void> => {
      while (!cancelled) {
        controller = new AbortController();
        setStatus('connecting');
        try {
          const url = `${baseUrl ?? ''}/v1/calls/${callId}/events/stream`;
          const headers: Record<string, string> = {};
          if (bearerToken) headers.authorization = `Bearer ${bearerToken}`;
          const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
          if (isCancelled()) {
            await response.body?.cancel();
            return;
          }
          if (!response.ok || !response.body) {
            throw new Error(`SSE connect failed: ${String(response.status)}`);
          }
          setStatus('replaying');
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (!cancelled) {
            const { value, done } = await reader.read();
            if (isCancelled()) return;
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split('\n\n');
            buffer = frames.pop() ?? '';
            for (const frame of frames) {
              if (cancelled) break;
              const parsed = parseFrame(frame);
              if (!parsed) continue;
              if (parsed.event === 'replay-end') {
                setStatus('open');
                continue;
              }
              if (parsed.event === 'replay' || parsed.event === 'call.event') {
                const parsedEvent = safeParse(parsed.data);
                if (!parsedEvent) continue;
                const evt = toStreamEvent(parsedEvent);
                if (evt && !seen.has(evt.id)) {
                  seen.add(evt.id);
                  setStream((prev) =>
                    prev.scope === scope ? { ...prev, events: [...prev.events, evt] } : prev,
                  );
                }
              }
              if (parsed.event === 'close') {
                setStatus('closed');
                cancelled = true;
              }
            }
          }
          backoff = INITIAL_BACKOFF_MS;
        } catch (err) {
          if (cancelled) return;
          if (err instanceof Error && err.name === 'AbortError') return;
        }
        if (cancelled) return;
        setStatus('connecting');
        await new Promise<void>((resolve) => {
          retryTimer = setTimeout(resolve, backoff);
        });
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    };

    void run();

    return (): void => {
      cancelled = true;
      controller.abort();
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, [scope]);

  // Hide the previous scope synchronously, before the new effect connects.
  return {
    events: stream.scope === scope ? stream.events : [],
    status: stream.scope === scope ? stream.status : enabled ? 'connecting' : 'idle',
    reconnect,
  };
}

interface SseFrame {
  readonly event: string;
  readonly data: string;
}

function parseFrame(frame: string): SseFrame | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

function safeParse(json: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function toStreamEvent(raw: Record<string, unknown>): CallStreamEvent | null {
  const id =
    typeof raw.id === 'string'
      ? raw.id
      : typeof raw.callEventId === 'string'
        ? raw.callEventId
        : null;
  const eventType =
    typeof raw.eventType === 'string'
      ? raw.eventType
      : typeof raw.type === 'string'
        ? raw.type
        : null;
  const timestamp = typeof raw.timestamp === 'string' ? raw.timestamp : null;
  const data =
    typeof raw.data === 'object' && raw.data !== null ? (raw.data as Record<string, unknown>) : {};
  if (id === null || eventType === null || timestamp === null) return null;
  return { id, eventType, timestamp, data };
}
