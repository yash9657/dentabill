import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OverviewStatStrip } from './overview-stat-strip.js';

describe('<OverviewStatStrip />', () => {
  it('renders one cell per stat with label, value, and optional caption', () => {
    render(
      <OverviewStatStrip
        stats={[
          { label: 'Calls today', value: '—', caption: 'Coming soon' },
          { label: 'Queue depth', value: '0' },
        ]}
      />,
    );
    const region = screen.getByRole('region', { name: /headline metrics/i });
    expect(within(region).getByText(/calls today/i)).toBeInTheDocument();
    expect(within(region).getByText('—')).toBeInTheDocument();
    expect(within(region).getByText(/coming soon/i)).toBeInTheDocument();
    expect(within(region).getByText(/queue depth/i)).toBeInTheDocument();
    expect(within(region).getByText('0')).toBeInTheDocument();
  });

  it('does not render a caption row when caption is omitted', () => {
    render(<OverviewStatStrip stats={[{ label: 'Solo', value: '12' }]} />);
    const cell = screen.getByText('Solo').parentElement!;
    expect(within(cell).queryByText(/caption/i)).not.toBeInTheDocument();
  });
});
