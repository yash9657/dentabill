'use client';

import { useAuth, useUser } from '@clerk/nextjs';
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

import { useDentaBillApi } from '../../lib/api-client.js';
import {
  OnboardingFormSchema,
  SUPPORTED_PAYERS,
  type OnboardingFormValues,
} from '../../lib/onboarding-schema.js';

/**
 * `<OnboardingForm>` — the post-sign-up form rendered at /onboarding.
 *
 * Submits directly to the apps/api `POST /v1/onboarding` endpoint
 * carrying the Clerk session JWT. The endpoint creates the DentaBill
 * `Organization` + `User` rows and stamps `publicMetadata.onboarded`
 * on the Clerk user; on success we route to `/dashboard/overview`.
 *
 * The form is intentionally kept short (4 fields). Heavier
 * qualification — multi-location practices, billing-team size — is
 * collected during the demo call rather than here.
 *
 * Idempotency: the API endpoint is safe to retry. If the user
 * already has a DentaBill `User` row, the response is `200 +
 * alreadyOnboarded: true` and we still navigate to the dashboard.
 */
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? (typeof window === 'undefined' ? 'http://localhost:3001' : '');

interface SubmitError {
  readonly message: string;
}

interface OnboardingResponse {
  readonly organizationId: string;
  readonly userId: string;
  readonly alreadyOnboarded: boolean;
}

interface ApiErrorBody {
  readonly error?: boolean;
  readonly message?: string;
  readonly code?: string;
}

export function OnboardingForm(): React.ReactElement {
  const router = useRouter();
  const { withAuthHeaders } = useDentaBillApi();
  const { getToken } = useAuth();
  const { user } = useUser();
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
      const headers = await withAuthHeaders();
      // Defensive client-side check: if Clerk's `getToken()` returned
      // null `withAuthHeaders` produces no `authorization` header. The
      // API will reject the request as anonymous; getting ahead of the
      // round-trip lets us surface the real cause ("session expired")
      // instead of a generic auth failure.
      if (!('authorization' in headers)) {
        setSubmitError({
          message:
            'Your sign-in session expired. Sign in again and we will pick up where you left off.',
        });
        router.push('/sign-in?redirect_url=/onboarding');
        return;
      }

      const response = await fetch(`${API_BASE_URL}/v1/onboarding`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(values),
      });
      const json = (await response.json().catch(() => ({}))) as OnboardingResponse | ApiErrorBody;
      if (!response.ok) {
        // Map status codes to actionable copy. The 401 path is the most
        // common real-user surprise (long idle on the form, JWT
        // expires); we send them to /sign-in with a return URL so the
        // form data is the only thing they lose.
        if (response.status === 401) {
          setSubmitError({
            message:
              'Your sign-in session expired while you were filling this out. Sign in again to finish.',
          });
          router.push('/sign-in?redirect_url=/onboarding');
          return;
        }
        if (response.status === 403) {
          setSubmitError({
            message:
              'This account is not yet authorised. Write to hello@dentabill.example so we can sort it out.',
          });
          return;
        }
        if (response.status >= 500) {
          setSubmitError({
            message:
              'Our server hit an error saving that. Try again — your form is preserved on this page.',
          });
          return;
        }
        const message =
          (json as ApiErrorBody).message ??
          'Could not save your onboarding details. Try again or write to hello@dentabill.example.';
        setSubmitError({ message });
        return;
      }
      // The dashboard layout reads the DB (`User.clerkUserId`) to gate
      // onboarding rather than `publicMetadata.onboarded`, so we don't
      // need to fight Clerk's JWT cache here. A soft router push works
      // — the next request hits the dashboard layout, which finds the
      // freshly-created `User` row and lets the page render.
      //
      // We still call `user.reload()` + force-refresh the token as a
      // best-effort so any *other* code that reads publicMetadata sees
      // the new value sooner. Failures are non-fatal.
      try {
        if (user) await user.reload();
        await getToken({ skipCache: true });
      } catch {
        // best-effort
      }
      router.push('/dashboard/overview');
      router.refresh();
      return;
    } catch {
      setSubmitError({
        message:
          'Network error reaching DentaBill. Check your connection and try again — your form is preserved on this page.',
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
        </div>
      </>
    </Form>
  );
}
