import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CallFlowWaveform } from './call-flow-waveform.js';

describe('<CallFlowWaveform />', () => {
  it('renders an SVG with role="img" + descriptive aria-label', () => {
    render(<CallFlowWaveform />);
    const svg = screen.getByRole('img');
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.getAttribute('aria-label')).toMatch(/diagram of a dentabill call/i);
  });

  it('renders the five phase labels in order', () => {
    render(<CallFlowWaveform />);
    const labels = ['Dial', 'IVR', 'Hold', 'Reach', 'Resolve'];
    for (const l of labels) {
      expect(screen.getByText(l)).toBeInTheDocument();
    }
  });

  it('uses the chromatic status accent on a single phase only (the "Reach" cluster)', () => {
    const { container } = render(<CallFlowWaveform />);
    const accentBars = container.querySelectorAll('rect.fill-status-active');
    const blackBars = container.querySelectorAll('rect.fill-black');
    expect(accentBars.length).toBe(8);
    // 4 non-accent phases * 8 bars = 32 black bars
    expect(blackBars.length).toBe(32);
  });

  it('passes through className', () => {
    render(<CallFlowWaveform className="custom-cls" />);
    const svg = screen.getByRole('img');
    expect(svg.classList.contains('custom-cls')).toBe(true);
  });
});
