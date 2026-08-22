'use client';

import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from '@dentabill/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';

import {
  CLAIMS_PER_WEEK_BUCKETS,
  ContactFormSchema,
  type ContactFormValues,
} from '../../lib/contact-schema.js';

/**
 * `<ContactForm>` — the marketing-side contact form.
 *
 * Posts to the same-origin `/v1/contact` route handler (rate-limited
 * sink). The form is fully client-side: react-hook-form for state,
 * Zod resolver for validation (shared schema in `lib/contact-schema`),
 * `<Form>` chrome from `@dentabill/ui`. On success the form unmounts
 * itself and renders an inline acknowledgement message; on failure
 * the submit button surfaces the message inline.
 *
 * The four fields here are the four things we actually want to read
 * before replying. Long contact forms are the fastest way to lose a
 * real prospect, so the qualification questions live in the demo
 * call rather than on this page.
 */
const SUBMIT_ENDPOINT = '/v1/contact';

interface SubmitError {
  readonly message: string;
}

const SELECT_CLASS =
  'border-input focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';

const TEXTAREA_CLASS =
  'border-input placeholder:text-gray-warm focus-visible:border-ring focus-visible:ring-ring/50 flex w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';

export function ContactForm(): React.ReactElement {
  const [submitError, setSubmitError] = React.useState<SubmitError | null>(null);
  const [submitted, setSubmitted] = React.useState(false);
  const successRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!submitted || !successRef.current) return;
    if (typeof successRef.current.scrollIntoView === 'function') {
      successRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    successRef.current.focus();
  }, [submitted]);

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(ContactFormSchema as never),
    mode: 'onSubmit',
    defaultValues: {
      name: '',
      email: '',
      practiceName: '',
      claimsPerWeek: CLAIMS_PER_WEEK_BUCKETS[0],
      message: '',
    },
  });

  const onSubmit = async (values: ContactFormValues): Promise<void> => {
    setSubmitError(null);
    try {
      const response = await fetch(SUBMIT_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { message?: string } | null;
        setSubmitError({
          message:
            data?.message ??
            (response.status === 429
              ? 'Too many submissions from this network. Try again in a few minutes.'
              : 'Something went wrong sending that. Try again or write to hello@dentabill.example.'),
        });
        return;
      }
      setSubmitted(true);
      form.reset();
    } catch {
      setSubmitError({
        message: 'Network error sending the form. Try again or write to hello@dentabill.example.',
      });
    }
  };

  if (submitted) {
    return (
      <div
        ref={successRef}
        role="status"
        tabIndex={-1}
        className="hairline-edge bg-warm-stone/40 rounded-card-large focus-visible:ring-ring-blue flex flex-col items-start gap-4 p-8 outline-none focus-visible:ring-2"
      >
        <span
          aria-hidden
          className="border-status-active text-status-active inline-flex h-10 w-10 items-center justify-center rounded-full border bg-white"
        >
          <Check className="h-5 w-5" />
        </span>
        <div className="space-y-2">
          <p className="font-display text-card-heading text-balance font-light text-black">
            Thanks. We will be in touch within one business day.
          </p>
          <p className="text-body text-gray-dark">
            You will hear from a real engineer, not a sales rep. If you indicated you want access,
            an invite link will follow once we confirm your practice details.
          </p>
        </div>
      </div>
    );
  }

  const isSubmitting = form.formState.isSubmitting;

  return (
    <Form
      form={form as never}
      onSubmit={(e) => {
        void form.handleSubmit(onSubmit)(e);
      }}
      noValidate
    >
      <FormField<ContactFormValues, 'name'> name="name">
        {({ field }) => (
          <FormItem>
            <FormLabel>Your name</FormLabel>
            <FormControl>
              <Input
                {...field}
                autoComplete="name"
                placeholder="Alex Garcia"
                disabled={isSubmitting}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <FormField<ContactFormValues, 'email'> name="email">
        {({ field }) => (
          <FormItem>
            <FormLabel>Work email</FormLabel>
            <FormControl>
              <Input
                {...field}
                type="email"
                autoComplete="email"
                placeholder="alex@yourpractice.com"
                disabled={isSubmitting}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <FormField<ContactFormValues, 'practiceName'> name="practiceName">
        {({ field }) => (
          <FormItem>
            <FormLabel>Practice name</FormLabel>
            <FormControl>
              <Input
                {...field}
                autoComplete="organization"
                placeholder="Sunrise Family Dental"
                disabled={isSubmitting}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <FormField<ContactFormValues, 'claimsPerWeek'> name="claimsPerWeek">
        {({ field }) => (
          <FormItem>
            <FormLabel>Claims followed up per week</FormLabel>
            <FormControl>
              <select {...field} className={SELECT_CLASS} disabled={isSubmitting}>
                {CLAIMS_PER_WEEK_BUCKETS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <FormField<ContactFormValues, 'message'> name="message">
        {({ field }) => (
          <FormItem>
            <FormLabel>What is on your mind?</FormLabel>
            <FormControl>
              <textarea
                {...field}
                rows={5}
                placeholder="A sentence or two about which payers you work with most and what you would like to ask us."
                className={TEXTAREA_CLASS}
                disabled={isSubmitting}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Sending...' : 'Send'}
        </Button>
        {submitError ? (
          <p role="alert" className="text-caption text-black">
            {submitError.message}
          </p>
        ) : null}
      </div>
    </Form>
  );
}
