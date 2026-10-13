'use client';

import {
  Button,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from '@dentabill/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useMe, useUpdateOrganization } from '../../../lib/me/use-me.js';

const OrganizationSettingsSchema = z.object({
  name: z.string().trim().min(2, 'Practice name is required.').max(160),
  npi: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{10}$/.test(v), 'NPI must be exactly 10 digits or empty.'),
});

type OrganizationSettingsValues = z.infer<typeof OrganizationSettingsSchema>;

const READ_ONLY_ROLES = new Set(['BILLING_STAFF']);

export function OrganizationSettingsForm(): React.ReactElement {
  const me = useMe();
  const update = useUpdateOrganization();
  const searchParams = useSearchParams();
  const focusField = searchParams.get('focus');
  const npiInputRef = React.useRef<HTMLInputElement | null>(null);

  const form = useForm<OrganizationSettingsValues>({
    resolver: zodResolver(OrganizationSettingsSchema as never),
    mode: 'onSubmit',
    defaultValues: { name: '', npi: '' },
  });

  React.useEffect(() => {
    if (!me.data) return;
    form.reset({
      name: me.data.organization.name,
      npi: me.data.organization.npi ?? '',
    });
  }, [me.data, form]);

  React.useEffect(() => {
    if (focusField === 'npi' && me.data && npiInputRef.current) {
      npiInputRef.current.focus();
      npiInputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusField, me.data]);

  if (me.isPending) {
    return (
      <div className="hairline-edge rounded-card bg-white p-6">
        <p className="text-body text-gray-warm">Loading practice details…</p>
      </div>
    );
  }
  if (me.isError) {
    return (
      <div className="hairline-edge rounded-card bg-white p-6">
        <p role="alert" className="text-body text-gray-dark">
          {me.error.message || 'Could not load practice details.'}
        </p>
      </div>
    );
  }

  const isReadOnly = READ_ONLY_ROLES.has(me.data.user.role);
  const npiMissing = me.data.organization.npi === null || me.data.organization.npi === '';

  const onSubmit = form.handleSubmit(async (values) => {
    update.reset();
    try {
      await update.mutateAsync(values);
    } catch {
      // mutation.error is surfaced inline below; nothing else to do.
    }
  });

  return (
    <div className="hairline-edge rounded-card flex flex-col gap-6 bg-white p-6">
      <div>
        <h2 className="font-body text-[20px] font-medium leading-[1.2] tracking-[-0.01em] text-black">
          Practice details
        </h2>
        <p className="text-caption text-gray-warm mt-1">
          Signed in as <span className="text-gray-dark font-medium">{me.data.user.email}</span>
          {' · '}
          <span className="uppercase tracking-[0.12em]">{me.data.user.role}</span>
        </p>
      </div>

      {npiMissing ? (
        <div
          role="status"
          className="rounded-card hairline-edge bg-warm-stone/40 text-body text-gray-dark px-4 py-3"
        >
          <span className="text-black">NPI is missing.</span> The payer rep needs your 10-digit
          National Provider Identifier to look up claims. Calls to Delta Dental, Cigna, and MetLife
          are blocked until you add it.
        </div>
      ) : null}

      <Form
        form={form as never}
        onSubmit={(e) => {
          void onSubmit(e);
        }}
        className="flex flex-col gap-5"
        noValidate
      >
        <FormField<OrganizationSettingsValues, 'name'> name="name">
          {({ field }) => (
            <FormItem>
              <FormLabel>Practice name</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="text"
                  autoComplete="organization"
                  disabled={isReadOnly || update.isPending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        </FormField>

        <FormField<OrganizationSettingsValues, 'npi'> name="npi">
          {({ field }) => (
            <FormItem>
              <FormLabel>NPI (National Provider Identifier)</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  ref={(el: HTMLInputElement | null) => {
                    field.ref(el);
                    npiInputRef.current = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="10 digits"
                  disabled={isReadOnly || update.isPending}
                  maxLength={10}
                />
              </FormControl>
              <FormDescription>
                10-digit number issued by CMS. Find yours at{' '}
                <span className="font-mono text-xs">npiregistry.cms.hhs.gov</span>.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        </FormField>

        {update.isError ? (
          <p
            role="alert"
            className="text-caption text-gray-dark hairline-edge rounded-card bg-warm-stone/30 px-3 py-2"
          >
            {update.error.message || 'Could not save changes.'}
          </p>
        ) : null}

        {update.isSuccess ? (
          <p aria-live="polite" className="text-caption text-gray-warm">
            Saved.
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            size="default"
            disabled={isReadOnly || update.isPending || !form.formState.isDirty}
          >
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
          {isReadOnly ? (
            <span className="text-caption text-gray-warm">
              Your role is read-only. Ask an OWNER or ADMIN to make edits.
            </span>
          ) : null}
        </div>
      </Form>
    </div>
  );
}

export { OrganizationSettingsSchema, type OrganizationSettingsValues };
