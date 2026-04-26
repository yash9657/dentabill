import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaimsImportPage } from './claims-import-page.js';

vi.mock('../../../lib/api-client.js', () => ({
  useDentaBillApi: () => ({
    client: { GET: vi.fn(), PATCH: vi.fn() },
    withAuthHeaders: async () => ({}),
  }),
}));

const fetchMock = vi.fn();

beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_dummy');
  globalThis.fetch = fetchMock;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  fetchMock.mockReset();
});

function makeFile(content: string, name = 'sample.csv', type = 'text/csv'): File {
  return new File([content], name, { type });
}

function renderPage(): { user: ReturnType<typeof userEvent.setup> } {
  const user = userEvent.setup();
  render(
    <QueryProvider client={createDentaBillQueryClient()}>
      <ClaimsImportPage />
    </QueryProvider>,
  );
  return { user };
}

describe('<ClaimsImportPage />', () => {
  it('shows the upload form heading and CTA', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /upload claims csv/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /choose csv/i })).toBeInTheDocument();
  });

  it('rejects an oversized file with an inline error and never calls fetch', async () => {
    const { user } = renderPage();
    const huge = makeFile('a'.repeat(11 * 1024 * 1024));
    const input = screen
      .getByRole('region', { name: /csv upload/i })
      .querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    await user.upload(input as HTMLInputElement, huge);
    expect(screen.getByRole('alert')).toHaveTextContent(/over 10 MB/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uploads a valid CSV and renders the parse summary on success', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () =>
        Promise.resolve({
          source: 'DENTRIX',
          totalRows: 3,
          validRows: 3,
          insertedRows: 2,
          skippedDuplicates: 1,
          errors: [],
        }),
    });
    const { user } = renderPage();
    const input = screen
      .getByRole('region', { name: /csv upload/i })
      .querySelector('input[type="file"]');
    await user.upload(input as HTMLInputElement, makeFile('Patient ID,foo\n1,2\n'));
    await user.click(screen.getByRole('button', { name: /upload claims/i }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /imported 2 new claims/i })).toBeInTheDocument();
    });
    expect(screen.getByText('Skipped (duplicates)')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('renders the API error message when the upload fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () =>
        Promise.resolve({
          error: true,
          message: 'Unrecognised CSV format.',
          code: 'VALIDATION_ERROR',
        }),
    });
    const { user } = renderPage();
    const input = screen
      .getByRole('region', { name: /csv upload/i })
      .querySelector('input[type="file"]');
    await user.upload(input as HTMLInputElement, makeFile('Foo,Bar\n1,2\n'));
    await user.click(screen.getByRole('button', { name: /upload claims/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/unrecognised csv format/i);
    });
  });
});
