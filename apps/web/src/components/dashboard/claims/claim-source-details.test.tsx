import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  sourceCoverageFixture,
  sourceDetailsFixture,
  sourceLineFixture,
} from './claim-source-details.fixtures.js';
import { ClaimSourceDetailsSection } from './claim-source-details.js';

describe('<ClaimSourceDetailsSection />', () => {
  it('preserves separate repeated codes, exact amounts, raw locations and nullable quantity', async () => {
    const user = userEvent.setup();
    render(<ClaimSourceDetailsSection details={sourceDetailsFixture()} currentAmount="420.00" />);
    const rows = within(
      screen.getByRole('list', { name: 'Imported procedure lines' }),
    ).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole('heading', { name: 'Line 1 · D2391' })).toBeInTheDocument();
    expect(within(rows[1]!).getByRole('heading', { name: 'Line 2 · D2391' })).toBeInTheDocument();
    expect(within(rows[0]!).getByText('14')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('15')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('MO')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Quantity').nextElementSibling).toHaveTextContent(
      'Not supplied',
    );
    expect(within(rows[1]!).getByText('Quantity').nextElementSibling).toHaveTextContent('1.250');
    expect(screen.getByText('Imported billed total').nextElementSibling).toHaveTextContent(
      '$420.00',
    );
    expect(screen.getByText('Source version').nextElementSibling).toHaveTextContent('export-v2');
    await user.click(within(rows[0]!).getByText('Source line details'));
    expect(within(rows[0]!).getByText('source-line-1')).toBeVisible();
    expect(within(rows[0]!).getByText('procedure-1')).toBeVisible();
    expect(within(rows[0]!).getByText('Code version').nextElementSibling).toHaveTextContent('2026');
  });

  it('distinguishes secondary claim coverage from sequence and exposes only supplied optional data', async () => {
    const user = userEvent.setup();
    render(<ClaimSourceDetailsSection details={sourceDetailsFixture()} currentAmount="420.00" />);
    const rows = within(
      screen.getByRole('list', { name: 'Imported coverage entries' }),
    ).getAllByRole('listitem');
    expect(within(rows[0]!).getByText('Coverage sequence 1')).toBeInTheDocument();
    expect(within(rows[0]!).queryByText('Coverage for this claim')).not.toBeInTheDocument();
    expect(within(rows[1]!).getByText('Coverage sequence 2')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Coverage for this claim')).toBeInTheDocument();
    await user.click(within(rows[0]!).getByText('Coverage details'));
    expect(within(rows[0]!).getByText('Subscriber ID').nextElementSibling).toHaveTextContent(
      'Not supplied',
    );
    expect(within(rows[0]!).queryByText('Patient member ID')).not.toBeInTheDocument();
    await user.click(within(rows[1]!).getByText('Coverage details'));
    for (const text of [
      'synthetic-subscriber',
      'synthetic-member',
      'synthetic-group',
      'Dependent',
      'Jan 1, 2026',
      'Dec 31, 2026',
    ])
      expect(within(rows[1]!).getByText(text)).toBeVisible();
    expect(screen.getByText(/do not confirm eligibility, benefits or payment/)).toBeInTheDocument();
  });

  it('shows every supplied raw treatment field without inferring a dental location', () => {
    render(
      <ClaimSourceDetailsSection
        details={sourceDetailsFixture({
          lines: [
            sourceLineFixture({
              treatmentArea: 'source-area',
              tooth: '51',
              surface: 'source-surface',
              quadrant: 'source-quadrant',
              toothRange: '51–53',
              toothNumberingSystem: 'FDI (source)',
            }),
          ],
        })}
        currentAmount="420.00"
      />,
    );
    for (const text of [
      'source-area',
      '51',
      'source-surface',
      'source-quadrant',
      '51–53',
      'FDI (source)',
    ])
      expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('keeps the original total visibly distinct when the current amount changes', () => {
    render(<ClaimSourceDetailsSection details={sourceDetailsFixture()} currentAmount="500.01" />);
    expect(screen.getByText(/current claim amount is \$500.01/)).toHaveTextContent(
      'imported billed total remains $420.00',
    );
    expect(screen.getAllByText('$210.00')).toHaveLength(2);
  });

  it('compares exact decimal values without floating point rounding', () => {
    const { rerender } = render(
      <ClaimSourceDetailsSection
        details={sourceDetailsFixture({ importedClaimAmount: '420.00' })}
        currentAmount="420.000"
      />,
    );
    expect(screen.queryByText(/current claim amount is/)).not.toBeInTheDocument();
    rerender(
      <ClaimSourceDetailsSection
        details={sourceDetailsFixture({ importedClaimAmount: '9007199254740993.00' })}
        currentAmount="9007199254740992.00"
      />,
    );
    expect(screen.getByText(/current claim amount is/)).toBeInTheDocument();
  });

  it('explains legacy absence and does not synthesize lines from summary codes', () => {
    render(<ClaimSourceDetailsSection details={null} currentAmount="420.00" />);
    expect(screen.getByText(/No procedure or coverage snapshot was saved/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText('Imported billed total')).not.toBeInTheDocument();
  });

  it('handles empty snapshots and fully unspecified treatment locations', () => {
    const { rerender } = render(
      <ClaimSourceDetailsSection
        details={sourceDetailsFixture({ sourceVersion: null, lines: [], coverages: [] })}
        currentAmount="420.00"
      />,
    );
    expect(
      screen.getByText('No procedure lines were supplied with this snapshot.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('No coverage entries were supplied with this snapshot.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Source version').nextElementSibling).toHaveTextContent('Not supplied');
    rerender(
      <ClaimSourceDetailsSection
        details={sourceDetailsFixture({
          lines: [
            sourceLineFixture({
              sourceProcedureId: null,
              codeVersion: null,
              treatmentArea: null,
              tooth: null,
              surface: null,
              quadrant: null,
              toothRange: null,
              toothNumberingSystem: null,
            }),
          ],
        })}
        currentAmount="420.00"
      />,
    );
    expect(screen.getByText('No treatment location was supplied.')).toBeInTheDocument();
    expect(screen.queryByText('Code version')).not.toBeInTheDocument();
    expect(screen.queryByText('Source procedure ID')).not.toBeInTheDocument();
  });

  it('bounds 500 lines to 50 per page and retains all nine coverage entries', async () => {
    const user = userEvent.setup();
    const lines = Array.from({ length: 500 }, (_, i) =>
      sourceLineFixture({
        id: `line-${String(i)}`,
        sourceLineId: `source-line-${String(i)}`,
        position: i,
      }),
    );
    const coverages = Array.from({ length: 9 }, (_, i) =>
      sourceCoverageFixture({
        id: `coverage-${String(i)}`,
        sourceCoverageId: `source-coverage-${String(i)}`,
        sequence: i + 1,
        isClaimCoverage: i === 8,
      }),
    );
    render(
      <ClaimSourceDetailsSection
        details={sourceDetailsFixture({ lines, coverages })}
        currentAmount="420.00"
      />,
    );
    const list = screen.getByRole('list', { name: 'Imported procedure lines' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(50);
    expect(screen.getByRole('button', { name: 'Previous procedures' })).toBeDisabled();
    for (let page = 0; page < 9; page++)
      await user.click(screen.getByRole('button', { name: 'Next procedures' }));
    expect(screen.getByRole('heading', { name: 'Line 500 · D2391' })).toBeInTheDocument();
    expect(within(list).getAllByRole('listitem')).toHaveLength(50);
    expect(screen.getByRole('status')).toHaveTextContent('Showing 451–500 of 500 procedure lines');
    expect(screen.getByRole('button', { name: 'Next procedures' })).toBeDisabled();
    expect(
      within(screen.getByRole('list', { name: 'Imported coverage entries' })).getAllByRole(
        'listitem',
      ),
    ).toHaveLength(9);
    await user.click(screen.getByRole('button', { name: 'Previous procedures' }));
    expect(screen.getByRole('heading', { name: 'Line 450 · D2391' })).toBeInTheDocument();
  });
});
