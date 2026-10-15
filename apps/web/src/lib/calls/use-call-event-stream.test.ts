import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCallEventStream } from './use-call-event-stream.js';

const streams: { close: () => void }[] = [];

function streamResponse(): { response: Response; emit: (id: string) => void; close: () => void } {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
    cancel() {
      closed = true;
    },
  });
  const stream = {
    response: new Response(body, { status: 200 }),
    emit(id: string): void {
      const event = {
        id,
        eventType: 'call.transcript',
        timestamp: '2026-10-13T12:00:00.000Z',
        data: { role: 'agent', text: id },
      };
      controller.enqueue(
        new TextEncoder().encode(`event: replay\ndata: ${JSON.stringify(event)}\n\n`),
      );
    },
    close(): void {
      if (!closed) controller.close();
      closed = true;
    },
  };
  streams.push(stream);
  return stream;
}

afterEach(() => {
  cleanup();
  for (const stream of streams.splice(0)) stream.close();
  vi.unstubAllGlobals();
});

describe('useCallEventStream isolation', () => {
  it('never exposes previous call events while changing calls, including a late old chunk', async () => {
    const first = streamResponse();
    const second = streamResponse();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response),
    );
    const renders: { callId: string; ids: string[] }[] = [];
    const { result, rerender } = renderHook(
      ({ callId }) => {
        const value = useCallEventStream({ callId, enabled: true });
        renders.push({ callId, ids: value.events.map((event) => event.id) });
        return value;
      },
      { initialProps: { callId: 'first' } },
    );
    await act(async () => {
      first.emit('first-event');
    });
    expect(result.current.events.map((event) => event.id)).toEqual(['first-event']);

    rerender({ callId: 'second' });
    expect(result.current.events).toEqual([]);
    await act(async () => {
      first.emit('late-first-event');
      second.emit('second-event');
    });
    expect(result.current.events.map((event) => event.id)).toEqual(['second-event']);
    expect(
      renders
        .filter((render) => render.callId === 'second')
        .every((render) => render.ids.every((id) => id === 'second-event')),
    ).toBe(true);
  });

  it.each(['bearerToken', 'baseUrl'] as const)(
    'clears events when %s changes for the same call',
    async (field) => {
      const first = streamResponse();
      const second = streamResponse();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response),
      );
      const initialProps = { bearerToken: 'first-session', baseUrl: '/first-api' };
      const { result, rerender } = renderHook(
        (props) => useCallEventStream({ callId: 'same-call', enabled: true, ...props }),
        { initialProps },
      );
      await act(async () => {
        first.emit('first-event');
      });
      expect(result.current.events).toHaveLength(1);
      rerender({ ...initialProps, [field]: 'second' });
      expect(result.current.events).toEqual([]);
      await act(async () => {
        second.emit('second-event');
      });
      expect(result.current.events.map((event) => event.id)).toEqual(['second-event']);
    },
  );

  it('rebuilds a manual replay once without retaining duplicate previous events', async () => {
    const first = streamResponse();
    const second = streamResponse();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(first.response)
      .mockResolvedValueOnce(second.response);
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useCallEventStream({ callId: 'call', enabled: true }));
    await act(async () => {
      first.emit('same-event');
    });
    act(() => {
      result.current.reconnect();
    });
    expect(result.current.events).toEqual([]);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      second.emit('same-event');
      second.emit('same-event');
    });
    expect(result.current.events.map((event) => event.id)).toEqual(['same-event']);
  });

  it('does not publish a response that arrives after the call scope changed', async () => {
    const first = streamResponse();
    const second = streamResponse();
    let resolveFirst!: (response: Response) => void;
    const pendingFirst = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValueOnce(pendingFirst).mockResolvedValueOnce(second.response),
    );
    const { result, rerender } = renderHook(
      ({ callId }) => useCallEventStream({ callId, enabled: true }),
      { initialProps: { callId: 'first' } },
    );
    first.emit('old-event');
    rerender({ callId: 'second' });
    await act(async () => {
      second.emit('current-event');
      resolveFirst(first.response);
    });
    expect(result.current.events.map((event) => event.id)).toEqual(['current-event']);
    expect(result.current.status).toBe('replaying');
  });

  it('clears data when the stream is disabled', async () => {
    const first = streamResponse();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(first.response));
    const { result, rerender } = renderHook(
      ({ enabled }) => useCallEventStream({ callId: 'call', enabled }),
      { initialProps: { enabled: true } },
    );
    await act(async () => {
      first.emit('old-event');
    });
    rerender({ enabled: false });
    await act(async () => {
      first.emit('late-event');
    });
    expect(result.current.events).toEqual([]);
    expect(result.current.status).toBe('idle');
  });
});
