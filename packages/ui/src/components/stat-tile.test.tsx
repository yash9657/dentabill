import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { StatTile } from './stat-tile.js';

describe('<StatTile />', () => {
  it('renders label, value, and optional caption', () => {
    render(<StatTile label="Total calls" value="42" caption="This month" />);
    expect(screen.getByText('Total calls')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('This month')).toBeInTheDocument();
  });

  it('applies label as micro size, uppercase, warm-gray', () => {
    render(<StatTile label="Status" value="Active" />);
    const label = screen.getByText('Status');
    expect(label.className).toContain('text-micro');
    expect(label.className).toContain('text-gray-warm');
    expect(label.className).toContain('font-medium');
  });

  it('applies value as 28–32px display weight 300, black', () => {
    render(<StatTile label="Count" value="1,234" />);
    const value = screen.getByText('1,234');
    expect(value.className).toContain('text-[28px]');
    expect(value.className).toContain('font-body');
    expect(value.className).toContain('font-semibold');
    expect(value.className).toContain('text-black');
  });

  it('applies caption as caption size, warm-gray (when present)', () => {
    render(<StatTile label="Usage" value="—" caption="Loading…" />);
    const caption = screen.getByText('Loading…');
    expect(caption.className).toContain('text-caption');
    expect(caption.className).toContain('text-gray-warm');
  });

  it('does not render caption when not provided', () => {
    render(<StatTile label="Stat" value="100" />);
    expect(screen.queryByText(/Loading|pending|caption/)).not.toBeInTheDocument();
  });

  it('supports em-dash placeholder for "no data yet"', () => {
    render(<StatTile label="Value" value="—" />);
    const dash = screen.getByText('—');
    expect(dash).toBeInTheDocument();
    expect(dash.className).toContain('text-[28px]');
  });

  it('merges className without losing core typography classes (twMerge)', () => {
    render(<StatTile label="Custom" value="Test" className="custom-class" />);
    const tile = screen.getByText('Custom').closest('div');
    expect(tile?.className).toContain('custom-class');
    expect(tile?.className).toContain('flex');
  });

  it('forwards refs to the underlying div', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<StatTile ref={ref} label="Ref test" value="123" />);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName).toBe('DIV');
  });

  it('renders React nodes as label, value, or caption', () => {
    render(
      <StatTile
        label={<strong>Custom label</strong>}
        value={<em>Custom value</em>}
        caption={<span data-testid="custom-caption">Custom caption</span>}
      />,
    );
    expect(screen.getByText('Custom label')).toBeInTheDocument();
    expect(screen.getByText('Custom value')).toBeInTheDocument();
    expect(screen.getByTestId('custom-caption')).toBeInTheDocument();
  });
});
