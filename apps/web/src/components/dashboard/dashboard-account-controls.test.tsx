import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DashboardAccountControls } from './dashboard-account-controls.js';

describe('<DashboardAccountControls /> (no Clerk keys path)', () => {
  it('renders the demo workspace placeholder when keys are absent', () => {
    render(<DashboardAccountControls />);
    expect(screen.getByLabelText(/demo workspace/i)).toBeInTheDocument();
  });

  it('renders the account placeholder avatar when keys are absent', () => {
    render(<DashboardAccountControls />);
    expect(screen.getByLabelText(/account placeholder/i)).toBeInTheDocument();
  });
});
