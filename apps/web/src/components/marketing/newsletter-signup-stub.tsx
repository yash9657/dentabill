'use client';

import { Button, cn, Input } from '@dentabill/ui';
import * as React from 'react';

/**
 * Newsletter signup, **stub edition**. Renders an email field and a
 * submit button; on submit it validates the email shape with a single
 * regex (the boundary check — the API does the real validation later)
 * and flips into a "Thanks for signing up." success state.
 *
 * It does **not** call the API yet. The contact + subscribe endpoints
 * land in P2-T24 (Contact page wires `POST /v1/contact`). Until that
 * lands the form is a deliberate UI-only scaffold so the footer
 * doesn't sit empty.
 *
 * Accessibility: the input has a visible `<label>` (visually-hidden so
 * the surrounding caption isn't duplicated, but exposed to assistive
 * tech), the success message uses `role="status"` so it's announced on
 * submit, and the validation error uses `aria-describedby` to attach
 * to the input.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface NewsletterSignupStubProps {
  readonly className?: string;
}

export function NewsletterSignupStub({ className }: NewsletterSignupStubProps): React.ReactElement {
  const [email, setEmail] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);
  const inputId = React.useId();
  const errorId = `${inputId}-error`;

  const onSubmit = (e: React.SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!EMAIL_RE.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <p role="status" className={cn('text-body-small text-gray-dark', className)}>
        Thanks. We&apos;ll keep you posted.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className={cn('space-y-3', className)}>
      <p className="text-body-small text-gray-dark">
        Monthly notes on dental billing automation. No spam.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={inputId} className="sr-only">
          Email address
        </label>
        <Input
          id={inputId}
          type="email"
          autoComplete="email"
          required
          placeholder="you@practice.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="flex-1"
        />
        <Button type="submit">Subscribe</Button>
      </div>
      {error ? (
        <p id={errorId} className="text-caption text-black" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
