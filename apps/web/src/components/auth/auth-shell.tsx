import { Check, LockKeyhole } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Wordmark } from '../marketing/wordmark.js';

export interface AuthShellProps {
  readonly children: React.ReactNode;
  readonly pageTitle: string;
  readonly pageDescription: string;
}
export function AuthShell({
  children,
  pageTitle,
  pageDescription,
}: AuthShellProps): React.ReactElement {
  return (
    <main className="auth-layout">
      <aside className="auth-story">
        <Link href="/" aria-label="DentaBill home">
          <Wordmark className="text-ink-inverse" />
        </Link>
        <div>
          <h2>
            Your patients need you.
            <br />
            <em>Your claims have us.</em>
          </h2>
          <p>
            A calmer way to manage insurance follow-ups. Bring your claims, let us make the calls,
            and get back to your practice.
          </p>
          <ul className="mt-10 space-y-4 text-sm">
            <li className="flex items-center gap-3">
              <Check size={17} />
              Calls handled from start to finish
            </li>
            <li className="flex items-center gap-3">
              <Check size={17} />
              Clear summaries and next steps
            </li>
            <li className="flex items-center gap-3">
              <Check size={17} />
              Free for dental practices
            </li>
          </ul>
        </div>
        <span className="flex items-center gap-2 text-xs">
          <LockKeyhole size={14} />
          Built with your practice’s privacy in mind.
        </span>
      </aside>
      <div className="auth-form-area">
        <Link href="/" aria-label="DentaBill home" className="mb-10 md:hidden">
          <Wordmark />
        </Link>
        <div className="mb-8 w-full max-w-md">
          <h1>{pageTitle}</h1>
          <p className="text-body-standard text-gray-dark mt-3">{pageDescription}</p>
        </div>
        <div className="w-full max-w-md">{children}</div>
        <p className="text-gray-warm mt-8 max-w-sm text-center text-xs leading-relaxed">
          By continuing you agree to our{' '}
          <Link href="/terms" className="hover:text-brand underline">
            Terms
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="hover:text-brand underline">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
