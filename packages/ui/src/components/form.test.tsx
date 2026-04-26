import { zodResolver } from '@hookform/resolvers/zod';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from './form.js';
import { Input } from './input.js';

/**
 * Test schema — a simple form with email and message fields.
 * No PHI — synthetic data only.
 */
const testSchema = z.object({
  email: z.string().email('Invalid email address'),
  message: z.string().min(3, 'Message must be at least 3 characters'),
});

type TestFormData = z.infer<typeof testSchema>;

/**
 * Helper component that renders a complete form with all parts wired.
 */
function TestForm({
  onSubmit,
  initialValues,
  disabled,
}: {
  onSubmit: (data: TestFormData) => void;
  initialValues?: Partial<TestFormData>;
  disabled?: boolean;
}): React.ReactElement {
  const form = useForm<TestFormData>({
    resolver: zodResolver(testSchema as never),
    defaultValues: initialValues ?? {
      email: '',
      message: '',
    },
    ...(disabled !== undefined && { disabled }),
  });

  const handleFormSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    void form.handleSubmit((data) => {
      onSubmit(data);
    })(e);
  };

  return (
    <Form form={form as never} onSubmit={handleFormSubmit}>
      <FormField name="email">
        {({ field }) => (
          <FormItem>
            <FormLabel>Email</FormLabel>
            <FormControl>
              <Input {...field} type="email" placeholder="user@example.com" />
            </FormControl>
            <FormDescription>We&apos;ll use this to contact you.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <FormField name="message">
        {({ field }) => (
          <FormItem>
            <FormLabel>Message</FormLabel>
            <FormControl>
              <Input {...field} placeholder="Your message here" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <button type="submit">Submit</button>
    </Form>
  );
}

describe('<Form /> and related components', () => {
  it('renders a complete form with all parts wired together', () => {
    const handleSubmit = vi.fn();
    const { container } = render(<TestForm onSubmit={handleSubmit} />);

    // Form elements exist.
    expect(container.querySelector('form')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
  });

  it('submits valid form data via the handleSubmit handler', async () => {
    const handleSubmit = vi.fn();
    const user = userEvent.setup();

    render(<TestForm onSubmit={handleSubmit} />);

    const emailInput = screen.getByLabelText('Email');
    const messageInput = screen.getByLabelText('Message');
    const submitBtn = screen.getByRole('button', { name: 'Submit' });

    // Fill form with valid data.
    await user.type(emailInput, 'test@example.com');
    await user.type(messageInput, 'Hello world');
    await user.click(submitBtn);

    // Wait for submission handler.
    expect(handleSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'test@example.com',
        message: 'Hello world',
      }),
    );
  });

  it('displays Zod validation error messages when validation fails', async () => {
    const handleSubmit = vi.fn();
    const user = userEvent.setup();

    render(<TestForm onSubmit={handleSubmit} />);

    const messageInput = screen.getByLabelText('Message');
    const submitBtn = screen.getByRole('button', { name: 'Submit' });

    // Leave email blank, fill message, submit.
    await user.click(messageInput);
    await user.type(messageInput, 'Hi');
    await user.click(submitBtn);

    // Validation errors should appear.
    expect(screen.getByText('Invalid email address')).toBeInTheDocument();
    expect(screen.getByText('Message must be at least 3 characters')).toBeInTheDocument();

    // Submit handler should NOT fire.
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('sets aria-invalid="true" on input when field has an error', async () => {
    const handleSubmit = vi.fn();
    const user = userEvent.setup();

    render(<TestForm onSubmit={handleSubmit} />);

    const emailInput = screen.getByLabelText('Email');
    const submitBtn = screen.getByRole('button', { name: 'Submit' });

    // Submit without filling email to trigger validation error.
    await user.click(submitBtn);

    expect(emailInput).toHaveAttribute('aria-invalid', 'true');
  });

  it('sets aria-invalid="false" on input when field is valid', async () => {
    const handleSubmit = vi.fn();
    const user = userEvent.setup();

    render(<TestForm onSubmit={handleSubmit} />);

    const emailInput = screen.getByLabelText('Email');

    // Initially, no error — aria-invalid="false".
    expect(emailInput).toHaveAttribute('aria-invalid', 'false');

    // Fill with valid email.
    await user.type(emailInput, 'test@example.com');

    // Still no error after valid input.
    expect(emailInput).toHaveAttribute('aria-invalid', 'false');
  });

  it('wires aria-describedby to include FormDescription id', () => {
    const handleSubmit = vi.fn();
    render(<TestForm onSubmit={handleSubmit} />);

    const emailInput = screen.getByLabelText('Email');
    const ariaDescribedBy = emailInput.getAttribute('aria-describedby');

    // The aria-describedby should include the description.
    expect(ariaDescribedBy).toBeTruthy();
    // The FormDescription text should be accessible via this id.
    const firstId = ariaDescribedBy?.split(' ')[0];
    const descElement = firstId ? document.getElementById(firstId) : null;
    expect(descElement?.textContent).toContain("We'll use this to contact you.");
  });

  it('renders FormDescription with caption typography and warm gray text', () => {
    const handleSubmit = vi.fn();
    render(<TestForm onSubmit={handleSubmit} />);

    const desc = screen.getByText("We'll use this to contact you.");
    expect(desc).toHaveClass('text-caption');
    expect(desc).toHaveClass('text-gray-warm');
  });

  it('renders error message with role="alert" when error is present', async () => {
    const handleSubmit = vi.fn();
    const user = userEvent.setup();

    render(<TestForm onSubmit={handleSubmit} />);

    const submitBtn = screen.getByRole('button', { name: 'Submit' });

    // Submit without data to trigger errors.
    await user.click(submitBtn);

    const errorMsg = screen.getByText('Invalid email address');
    expect(errorMsg).toHaveAttribute('role', 'alert');
  });

  it('does not render FormMessage when no error and no children provided', async () => {
    const handleSubmit = vi.fn();
    const user = userEvent.setup();

    render(<TestForm onSubmit={handleSubmit} />);

    const emailInput = screen.getByLabelText('Email');

    // Fill in valid email.
    await user.type(emailInput, 'test@example.com');
    // Do NOT submit — keep validation clean.

    // The message element for email should not exist yet (no error, no children).
    const messageElements = screen.queryAllByRole('alert');
    expect(messageElements).toHaveLength(0); // No errors triggered.
  });

  it('respects disabled state on the form and disables inputs', () => {
    const handleSubmit = vi.fn();

    render(<TestForm onSubmit={handleSubmit} disabled />);

    const emailInput = screen.getByLabelText('Email');
    const messageInput = screen.getByLabelText('Message');

    expect(emailInput).toBeDisabled();
    expect(messageInput).toBeDisabled();
  });

  it('allows custom error messages via FormMessage children', () => {
    /**
     * Custom form with a FormMessage that has children (custom error display).
     */
    function CustomErrorForm(): React.ReactElement {
      const formInstance = useForm<TestFormData>({
        resolver: zodResolver(testSchema as never),
        defaultValues: { email: '', message: '' },
      });

      const handleFormSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
        void formInstance.handleSubmit(() => {
          // No-op handler for this test.
        })(e);
      };

      return (
        <Form form={formInstance as never} onSubmit={handleFormSubmit}>
          <FormField name="email">
            {({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input {...field} type="email" />
                </FormControl>
                <FormMessage>Custom fallback text if no error</FormMessage>
              </FormItem>
            )}
          </FormField>
          <button type="submit">Submit</button>
        </Form>
      );
    }

    render(<CustomErrorForm />);

    // When there's no error, children are shown.
    expect(screen.getByText('Custom fallback text if no error')).toBeInTheDocument();
  });

  it('label is linked to input via htmlFor and id', () => {
    const handleSubmit = vi.fn();
    render(<TestForm onSubmit={handleSubmit} />);

    const label = screen.getByText('Email');
    const input = screen.getByLabelText('Email');

    // The label's 'for' attribute should match the input's id.
    expect(label).toHaveAttribute('for', (input as HTMLInputElement).id);
  });

  it('multiple form fields can coexist in a single form', async () => {
    const handleSubmit = vi.fn();
    const user = userEvent.setup();

    render(<TestForm onSubmit={handleSubmit} />);

    // Both fields should render and be independently controllable.
    const emailInput = screen.getByLabelText('Email');
    const messageInput = screen.getByLabelText('Message');

    // Fill one field.
    await user.type(emailInput, 'test@example.com');

    // The other field should be empty.
    expect((messageInput as HTMLInputElement).value).toBe('');

    // Fill the other.
    await user.type(messageInput, 'Test message');

    // Both should now have values.
    expect((emailInput as HTMLInputElement).value).toBe('test@example.com');
    expect((messageInput as HTMLInputElement).value).toBe('Test message');
  });
});
