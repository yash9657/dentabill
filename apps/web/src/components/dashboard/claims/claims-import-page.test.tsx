import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { sourceDatabaseError, type ImportSummary } from '../../../lib/claims/use-claims-import.js';

import { ClaimsImportPage, importRowReportCsv } from './claims-import-page.js';

const auth = vi.hoisted(() => ({ orgId: 'org_one' }));
const authHeaders = vi.hoisted(() => vi.fn<() => Promise<Record<string, string>>>());
vi.mock('@clerk/nextjs', () => ({ useAuth: () => auth }));
vi.mock('../../../lib/api-client.js', () => ({
  useDentaBillApi: () => ({
    withAuthHeaders: authHeaders,
  }),
}));

const fetchMock = vi.fn<typeof fetch>();
beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_dummy');
  vi.stubGlobal('fetch', fetchMock);
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  fetchMock.mockReset();
  authHeaders.mockReset().mockResolvedValue({ Authorization: 'Bearer synthetic-test-token' });
  auth.orgId = 'org_one';
});

function makeFile(
  content = 'SourceClaimId,ClaimNumber\nsource-1,display-1\n',
  name = 'sample.csv',
): File {
  return new File([content], name, { type: 'text/csv' });
}
function summary(overrides: Partial<ImportSummary> = {}): ImportSummary {
  return {
    source: 'DENTRIX',
    sourceNamespace: 'main-office',
    totalRows: 1,
    validRows: 1,
    insertedRows: 1,
    skippedDuplicates: 0,
    conflictRows: 0,
    rows: [{ rowIndex: 2, disposition: 'INSERTED', claimId: 'claim-one' }],
    errors: [],
    ...overrides,
  };
}
function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function renderPage(): {
  user: ReturnType<typeof userEvent.setup>;
  rerenderPage: () => void;
} {
  const client = createDentaBillQueryClient();
  const view = () => (
    <QueryProvider client={client}>
      <ClaimsImportPage />
    </QueryProvider>
  );
  const rendered = render(view());
  return {
    user: userEvent.setup({ applyAccept: false }),
    rerenderPage: () => {
      rendered.rerender(view());
    },
  };
}
async function fillUpload(
  user: ReturnType<typeof userEvent.setup>,
  source = 'main-office',
): Promise<void> {
  if (source) await user.type(screen.getByRole('textbox', { name: 'Source database' }), source);
  await user.upload(screen.getByLabelText('Choose CSV file'), makeFile());
}
async function submit(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Upload claims' }));
}

describe('<ClaimsImportPage />', () => {
  it('explains stable database identity, original IDs and upload limits without compliance claims', () => {
    renderPage();
    expect(screen.getByRole('textbox', { name: 'Source database' })).toBeRequired();
    expect(screen.getByText(/Reuse it for every upload/)).toBeInTheDocument();
    expect(screen.getByText('SourceClaimId')).toBeInTheDocument();
    expect(screen.getByText('ClaimNum')).toBeInTheDocument();
    expect(screen.getByText(/5,000 rows/)).toBeInTheDocument();
    expect(
      screen.queryByText(/HIPAA|hashed|deduplicated by claim number/i),
    ).not.toBeInTheDocument();
  });

  it.each(['', 'Main-Office', 'main office', '-main', 'office/one'])(
    'blocks an invalid source database %j before sending',
    async (source) => {
      const { user } = renderPage();
      await fillUpload(user, source);
      await submit(user);
      expect(screen.getByRole('alert')).toHaveTextContent(
        source ? /lowercase/ : /Enter a source database/,
      );
      expect(screen.getByRole('textbox', { name: 'Source database' })).toHaveFocus();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('sends the exact explicit source header and authenticated multipart body', async () => {
    fetchMock.mockResolvedValueOnce(response(summary({ sourceNamespace: '0-office_2026' })));
    const { user } = renderPage();
    await fillUpload(user, '0-office_2026');
    await submit(user);
    const heading = await screen.findByRole('heading', { name: 'Imported 1 new claim' });
    expect(heading).toHaveFocus();
    expect(screen.getByText('0-office_2026')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/v1\/ingest\/claims$/);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer synthetic-test-token',
      'x-import-source': '0-office_2026',
    });
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get('file')).toBeInstanceOf(File);
  });

  it('separates all row outcomes and links only unambiguous existing claims', async () => {
    fetchMock.mockResolvedValueOnce(
      response(
        summary({
          totalRows: 7,
          validRows: 6,
          insertedRows: 1,
          skippedDuplicates: 1,
          conflictRows: 5,
          rows: [
            { rowIndex: 2, disposition: 'INSERTED', claimId: 'claim-one' },
            { rowIndex: 3, disposition: 'DUPLICATE', claimId: 'claim-one' },
            { rowIndex: 4, disposition: 'SOURCE_CHANGED', claimId: 'existing-one' },
            { rowIndex: 5, disposition: 'BATCH_CONFLICT', claimId: null },
            { rowIndex: 6, disposition: 'LEGACY_MATCH', claimId: 'legacy-one' },
            { rowIndex: 7, disposition: 'LEGACY_MATCH', claimId: null },
            { rowIndex: 8, disposition: 'MISSING_SOURCE_ID', claimId: null },
          ],
          errors: [{ rowIndex: 8, message: 'Source claim ID is required.' }],
        }),
      ),
    );
    const { user } = renderPage();
    await fillUpload(user);
    await submit(user);
    await screen.findByRole('heading', { name: 'Imported 1 new claim' });
    expect(screen.getByText('Needs attention').nextElementSibling).toHaveTextContent('5');
    expect(screen.getByText(/5 rows need attention/)).toBeInTheDocument();
    const report = screen.getByRole('region', { name: 'Row report' });
    expect(within(report).getAllByRole('listitem')).toHaveLength(7);
    expect(within(report).getByText('Unchanged')).toBeInTheDocument();
    expect(within(report).getByText('Source changed')).toBeInTheDocument();
    expect(within(report).getByText('Conflicting rows')).toBeInTheDocument();
    expect(within(report).getByText('Missing source ID')).toBeInTheDocument();
    expect(within(report).getByText(/did not overwrite/)).toBeInTheDocument();
    expect(within(report).getByRole('link', { name: 'View claim for row 4' })).toHaveAttribute(
      'href',
      '/dashboard/claims/existing-one',
    );
    expect(within(report).getByRole('link', { name: 'View claim for row 6' })).toHaveAttribute(
      'href',
      '/dashboard/claims/legacy-one',
    );
    expect(
      within(report).queryByRole('link', { name: 'View claim for row 7' }),
    ).not.toBeInTheDocument();
    expect(within(report).getByText(/No single claim could be linked/)).toBeInTheDocument();
    expect(screen.getByText(/1 validation error/)).toBeInTheDocument();
  });

  it('keeps source identity for another upload in the same organization', async () => {
    fetchMock.mockImplementation(async () => response(summary()));
    const { user } = renderPage();
    await fillUpload(user);
    await submit(user);
    await user.click(await screen.findByRole('button', { name: 'Upload another file' }));
    expect(screen.getByRole('textbox', { name: 'Source database' })).toHaveValue('main-office');
    expect(screen.getByLabelText('Choose CSV file')).toHaveValue('');
    await user.upload(screen.getByLabelText('Choose CSV file'), makeFile());
    await submit(user);
    await screen.findByRole('heading', { name: 'Imported 1 new claim' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toHaveProperty('x-import-source', 'main-office');
  });

  it('locks the file and namespace while pending and prevents a second submission', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const { user } = renderPage();
    await fillUpload(user);
    await submit(user);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Uploading claims and checking source identities',
    );
    expect(screen.getByRole('textbox', { name: 'Source database' })).toBeDisabled();
    expect(screen.getByLabelText('Choose CSV file')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear file' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Uploading…' }));
    fireEvent.drop(screen.getByRole('region', { name: 'CSV upload' }), {
      dataTransfer: { files: [makeFile('other', 'other.csv')] },
    });
    expect(screen.queryByText('other.csv')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(response(summary()));
    });
    await screen.findByRole('heading', { name: 'Imported 1 new claim' });
  });

  it('clears pending file and source state on organization switch and ignores the old result', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const { user, rerenderPage } = renderPage();
    await fillUpload(user);
    await submit(user);
    auth.orgId = 'org_two';
    rerenderPage();
    expect(screen.getByRole('textbox', { name: 'Source database' })).toHaveValue('');
    expect(screen.getByLabelText('Choose CSV file')).toHaveValue('');
    await act(async () => {
      pending.resolve(response(summary()));
    });
    expect(screen.queryByRole('heading', { name: 'Imported 1 new claim' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose CSV' })).toBeEnabled();
  });

  it('never starts an old organization upload if authentication resolves after switching', async () => {
    const pending = deferred<Record<string, string>>();
    authHeaders.mockReturnValueOnce(pending.promise);
    const { user, rerenderPage } = renderPage();
    await fillUpload(user);
    await submit(user);
    expect(authHeaders).toHaveBeenCalledTimes(1);
    auth.orgId = 'org_two';
    rerenderPage();
    await act(async () => {
      pending.resolve({ Authorization: 'Bearer other-organization-token' });
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Source database' })).toHaveValue('');
  });

  it.each([
    ['empty', () => makeFile(''), /CSV is empty/],
    ['oversized', () => makeFile('a'.repeat(10 * 1024 * 1024 + 1)), /over 10 MB/],
    [
      'non-CSV',
      () => new File(['x'], 'claims.pdf', { type: 'application/pdf' }),
      /Choose a CSV file/,
    ],
  ] as const)('rejects an %s file and clears an earlier selection', async (_label, file, error) => {
    const { user } = renderPage();
    await fillUpload(user);
    await user.upload(screen.getByLabelText('Choose CSV file'), file());
    expect(screen.getByRole('alert')).toHaveTextContent(error);
    expect(screen.queryByRole('button', { name: 'Upload claims' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves the namespace and chosen file after a server rejection', async () => {
    fetchMock.mockResolvedValueOnce(response({ message: 'Unrecognised CSV format.' }, 400));
    fetchMock.mockResolvedValueOnce(response(summary()));
    const { user } = renderPage();
    await fillUpload(user);
    await submit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unrecognised CSV format.');
    expect(screen.getByRole('textbox', { name: 'Source database' })).toHaveValue('main-office');
    expect(screen.getByText('sample.csv')).toBeInTheDocument();
    await submit(user);
    await screen.findByRole('heading', { name: 'Imported 1 new claim' });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toHaveProperty('x-import-source', 'main-office');
  });

  it('uses a fixed ambiguous-upload message on network failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('private transport detail'));
    const { user } = renderPage();
    await fillUpload(user);
    await submit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not be confirmed.*same CSV and source database/,
    );
    expect(screen.queryByText(/private transport detail/)).not.toBeInTheDocument();
  });

  it.each([{}, summary({ sourceNamespace: 'other-office' })])(
    'does not present an unconfirmed or mismatched report as success',
    async (body) => {
      fetchMock.mockResolvedValueOnce(response(body));
      const { user } = renderPage();
      await fillUpload(user);
      await submit(user);
      expect(await screen.findByRole('alert')).toHaveTextContent(
        /import report could not be confirmed/,
      );
      expect(
        screen.queryByRole('heading', { name: 'Imported 1 new claim' }),
      ).not.toBeInTheDocument();
    },
  );

  it('bounds row rendering while allowing access to the final page', async () => {
    const rows: ImportSummary['rows'] = Array.from({ length: 51 }, (_, index) => ({
      rowIndex: index + 2,
      disposition: 'DUPLICATE',
      claimId: `claim-${String(index)}`,
    }));
    fetchMock.mockResolvedValueOnce(
      response(
        summary({ totalRows: 51, validRows: 51, insertedRows: 0, skippedDuplicates: 51, rows }),
      ),
    );
    const { user } = renderPage();
    await fillUpload(user);
    await submit(user);
    await screen.findByRole('heading', { name: 'No new claims' });
    const report = screen.getByRole('region', { name: 'Row report' });
    expect(within(report).getAllByRole('listitem')).toHaveLength(50);
    expect(within(report).getByRole('status')).toHaveTextContent('Showing 1–50 of 51 rows');
    expect(screen.getByRole('button', { name: 'Previous rows' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next rows' }));
    expect(within(report).getAllByRole('listitem')).toHaveLength(1);
    expect(within(report).getByText('Row 52')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next rows' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Previous rows' }));
    expect(within(report).getByText('Row 2')).toBeInTheDocument();
  });

  it('clears completed results on organization switch', async () => {
    fetchMock.mockResolvedValueOnce(response(summary()));
    const { user, rerenderPage } = renderPage();
    await fillUpload(user);
    await submit(user);
    await screen.findByRole('heading', { name: 'Imported 1 new claim' });
    auth.orgId = 'org_two';
    rerenderPage();
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Source database' })).toHaveValue('');
    });
    expect(screen.queryByRole('region', { name: 'Row report' })).not.toBeInTheDocument();
  });

  it('makes every validation error accessible across bounded pages', async () => {
    const errors = Array.from({ length: 51 }, (_, index) => ({
      rowIndex: index + 2,
      message: `Correct required field ${String(index + 1)}.`,
    }));
    fetchMock.mockResolvedValueOnce(
      response(
        summary({
          totalRows: 51,
          validRows: 0,
          insertedRows: 0,
          rows: [],
          errors,
        }),
      ),
    );
    const { user } = renderPage();
    await fillUpload(user);
    await submit(user);
    await user.click(await screen.findByText('51 validation errors to review'));
    expect(
      within(screen.getByRole('list', { name: 'Validation errors' })).getAllByRole('listitem'),
    ).toHaveLength(50);
    expect(screen.getByText('Correct required field 26.', { exact: false })).toBeInTheDocument();
    expect(
      screen.queryByText('Correct required field 51.', { exact: false }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous errors' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next errors' }));
    expect(
      within(screen.getByRole('list', { name: 'Validation errors' })).getAllByRole('listitem'),
    ).toHaveLength(1);
    expect(screen.getByText('Correct required field 51.', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next errors' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Previous errors' }));
    expect(screen.getByText('Correct required field 1.', { exact: false })).toBeInTheDocument();
  });
});

describe('import input and report boundaries', () => {
  it('accepts the full 80-character namespace but never normalizes invalid identity', () => {
    expect(sourceDatabaseError('a'.repeat(80))).toBeNull();
    for (const value of ['a'.repeat(81), ' main-office', 'main-office ', 'MAIN-OFFICE', 'máin']) {
      expect(sourceDatabaseError(value)).not.toBeNull();
    }
  });

  it('exports only row outcomes and internal IDs with CSV and formula escaping', () => {
    const csv = importRowReportCsv([
      { rowIndex: 2, disposition: 'SOURCE_CHANGED', claimId: 'claim,"quoted"\nnext' },
      { rowIndex: 3, disposition: 'LEGACY_MATCH', claimId: '=SUM(A1)' },
      { rowIndex: 4, disposition: 'DUPLICATE', claimId: '  +1' },
      { rowIndex: 5, disposition: 'MISSING_SOURCE_ID', claimId: null },
    ]);
    expect(csv).toBe(
      '"rowIndex","disposition","claimId"\r\n"2","SOURCE_CHANGED","claim,""quoted""\nnext"\r\n"3","LEGACY_MATCH","\'=SUM(A1)"\r\n"4","DUPLICATE","\'  +1"\r\n"5","MISSING_SOURCE_ID",""',
    );
  });
});
