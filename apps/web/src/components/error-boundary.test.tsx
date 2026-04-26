import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './error-boundary.js';

function Boom({ shouldThrow = true }: { readonly shouldThrow?: boolean }): React.ReactElement {
  if (shouldThrow) {
    throw new Error('intentional test failure');
  }
  return <p>recovered</p>;
}

describe('<ErrorBoundary />', () => {
  // React logs caught errors to console.error. Suppress for cleaner test output.
  const originalConsoleError = console.error;
  beforeAll(() => {
    console.error = vi.fn();
  });
  afterAll(() => {
    console.error = originalConsoleError;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary fallback={<p>fallback</p>}>
        <p>healthy</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('healthy')).toBeInTheDocument();
  });

  it('renders the fallback element when a child throws', () => {
    render(
      <ErrorBoundary fallback={<p>fallback</p>}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('fallback')).toBeInTheDocument();
  });

  it('renders a render-prop fallback with error + reset', async () => {
    const user = userEvent.setup();
    let recovered = false;

    function App(): React.ReactElement {
      // Toggling local state via reset re-renders the boundary subtree.
      const [bombArmed, setBombArmed] = React.useState(true);
      return (
        <ErrorBoundary
          fallback={({ error, reset }) => (
            <div>
              <p>Captured: {error.message}</p>
              <button
                type="button"
                onClick={() => {
                  setBombArmed(false);
                  reset();
                  recovered = true;
                }}
              >
                Try again
              </button>
            </div>
          )}
        >
          <Boom shouldThrow={bombArmed} />
        </ErrorBoundary>
      );
    }

    render(<App />);

    expect(screen.getByText(/Captured: intentional test failure/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(recovered).toBe(true);
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });

  it('invokes the onError callback with the caught error', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary fallback={<p>fb</p>} onError={onError}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledOnce();
    const [err] = onError.mock.calls[0]!;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('intentional test failure');
  });
});
