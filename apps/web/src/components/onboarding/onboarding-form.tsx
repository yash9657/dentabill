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
  cn,
} from '@dentabill/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useForm } from 'react-hook-form';

import {
  OnboardingFormSchema,
  SUPPORTED_PAYERS,
  type OnboardingFormValues,
} from '../../lib/onboarding-schema.js';

/**
 * `<OnboardingForm>` — the post-sign-up form rendered at /onboarding.
 *
 * Posts to `/v1/onboarding` (same-origin edge route, stub for now)
 * and on success pushes the router to `/dashboard/overview` —
 * matching `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL`. The real DB write
 * lives in `apps/api` and lands with P2-T37+; until then the route
 * acks 204 and the operator picks the structured log out of stdout.
 *
 * Form chrome reuses the same `<Form>` + `<FormField>` pattern as
 * the contact form so the submit / error / message flow is
 * identical across the codebase.
 *
 * Field rendering notes:
 *
 *   - Practice name and zip are plain inputs.
 *   - NPI is a plain input (no auto-formatting); the schema accepts
 *     either an empty string or exactly 10 digits.
 *   - acceptedPayers renders as a fieldset of checkboxes. Plain
 *     `<input type=checkbox>` keeps the markup small — react-hook-form
 *     `register` is enough to wire array updates.
 */
const SUBMIT_ENDPOINT = '/v1/onboarding';

interface SubmitError {
  readonly message: string;
}

export function OnboardingForm(): React.ReactElement {
  const router = useRouter();
  const [submitError, setSubmitError] = React.useState<SubmitError | null>(null);

  const form = useForm<OnboardingFormValues>({
    resolver: zodResolver(OnboardingFormSchema as never),
    mode: 'onSubmit',
    defaultValues: {
      practiceName: '',
      npi: '',
      zip: '',
      acceptedPayers: [],
    },
  });

  const onSubmit = async (values: OnboardingFormValues): Promise<void> => {
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
            'Something went wrong saving that. Try again or write to hello@dentabill.example.',
        });
        return;
      }
      router.push('/dashboard/overview');
    } catch {
      setSubmitError({
        message: 'Network error. Try again or write to hello@dentabill.example.',
      });
    }
  };

  const isSubmitting = form.formState.isSubmitting;

  return (
    <Form
      form={form as never}
      onSubmit={(e) => {
        void form.handleSubmit(onSubmit)(e);
      }}
      className="space-y-6"
      noValidate
    >
      <>
        <FormField<OnboardingFormValues, 'practiceName'> name="practiceName">
          {({ field }) => (
            <FormItem>
              <FormLabel>Practice name</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="Sunrise Family Dental"
                  autoComplete="organization"
                  disabled={isSubmitting}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        </FormField>

        <div className="grid gap-6 sm:grid-cols-2">
          <FormField<OnboardingFormValues, 'npi'> name="npi">
            {({ field }) => (
              <FormItem>
                <FormLabel>NPI (optional)</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    inputMode="numeric"
                    pattern="\d*"
                    maxLength={10}
                    placeholder="10-digit NPI"
                    autoComplete="off"
                    disabled={isSubmitting}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          </FormField>
          <FormField<OnboardingFormValues, 'zip'> name="zip">
            {({ field }) => (
              <FormItem>
                <FormLabel>Zip code</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    inputMode="numeric"
                    pattern="\d*"
                    maxLength={5}
                    placeholder="94110"
                    autoComplete="postal-code"
                    disabled={isSubmitting}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          </FormField>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-body mb-2 font-medium text-black">Accepted payers</legend>
          <p className="text-caption text-gray-warm mb-3">
            Pick the payers your practice files claims with. You can edit this anytime from
            Settings.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SUPPORTED_PAYERS.map((payer) => (
              <label
                key={payer}
                className={cn(
                  'hairline-edge text-body flex cursor-pointer items-center gap-3 rounded-md bg-white px-3 py-2 text-black transition-colors',
                  'hover:bg-stone-warm/40',
                  'has-checked:bg-stone-warm/60',
                )}
              >
                <input
                  type="checkbox"
                  value={payer}
                  {...form.register('acceptedPayers')}
                  disabled={isSubmitting}
                  className="h-4 w-4 accent-black"
                />
                <span>{payer}</span>
              </label>
            ))}
          </div>
          {form.formState.errors.acceptedPayers ? (
            <p className="text-caption text-black">
              {form.formState.errors.acceptedPayers.message}
            </p>
          ) : null}
        </fieldset>

        {submitError ? (
          <p role="alert" className="text-caption text-black">
            {submitError.message}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Setting up' : 'Continue to dashboard'}
          </Button>
          <a
            href="/dashboard/overview"
            className="text-caption text-gray-warm hover:text-black focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
          >
            Skip for now
          </a>
        </div>
      </>
    </Form>
  );
}
