import { z } from 'zod';

/**
 * Shared Zod schema for the post-sign-up `/onboarding` form.
 *
 * Lives in `lib/` so the same schema validates the client form
 * (`components/onboarding/onboarding-form.tsx`) and the server
 * route (`app/v1/onboarding/route.ts`). When the real API ships
 * (P2-T37+), this file is the single thing that needs to be
 * relocated and re-exported into `@dentabill/api`.
 *
 * Field choices are deliberately the smallest set that lets us
 * stand up an Organization row in the database:
 *
 *   - practiceName — required, the legal practice name. Used as
 *     the Clerk org display name and the DentaBill `Organization.name`.
 *   - npi — 10-digit National Provider Identifier. Operationally
 *     required for any payer the call worker can dial: the rep
 *     uses it to look up the claim. Conditionally required at
 *     onboarding (see refinement below) when the user accepts any
 *     of the Phase-3 dialable payers; otherwise empty is allowed
 *     (an evaluator who only accepts non-dialable payers can
 *     onboard without an NPI). The /dashboard/settings/organization
 *     page is the canonical surface for editing it post-onboarding.
 *   - zip — 5-digit US zip code. Drives payer-region routing and
 *     time-zone-of-day call windows.
 *   - acceptedPayers — at least one. Determines which IVR navigators
 *     the call worker loads for this org's claims. Editable later
 *     in /dashboard/settings/organization.
 *
 * The payer list is the same one the call worker will support in
 * Phase 1+. P2-T46 owns the canonical lookup table; until then this
 * inline set is the source of truth for the form.
 */
export const SUPPORTED_PAYERS = [
  'Delta Dental PPO',
  'Cigna Dental',
  'MetLife Dental',
  'Aetna Dental',
  'Guardian Dental',
  'Humana Dental',
  'United Concordia',
  'Anthem Dental',
] as const;

export type SupportedPayer = (typeof SUPPORTED_PAYERS)[number];

/**
 * Payers the Phase-3 call worker can actually dial. Selecting any of
 * these requires an NPI at onboarding, since the call enqueue route
 * pre-flights NPI presence and a missing one leaves the user staring
 * at the missing-NPI banner the moment they try to call.
 */
export const NPI_REQUIRED_PAYERS: ReadonlySet<SupportedPayer> = new Set([
  'Delta Dental PPO',
  'Cigna Dental',
  'MetLife Dental',
]);

export const OnboardingFormSchema = z
  .object({
    practiceName: z
      .string()
      .trim()
      .min(2, 'Tell us the practice name.')
      .max(160, 'Practice name is too long.'),
    npi: z
      .string()
      .trim()
      .refine((value) => value === '' || /^\d{10}$/.test(value), {
        message: 'NPI is 10 digits, or leave blank to skip.',
      }),
    zip: z
      .string()
      .trim()
      .regex(/^\d{5}$/, 'Use a 5-digit US zip code.'),
    acceptedPayers: z
      .array(z.enum(SUPPORTED_PAYERS))
      .min(1, 'Select at least one payer.')
      .max(SUPPORTED_PAYERS.length, 'You picked more payers than exist.'),
  })
  .superRefine((data, ctx) => {
    const requiresNpi = data.acceptedPayers.some((p) => NPI_REQUIRED_PAYERS.has(p));
    if (requiresNpi && data.npi.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['npi'],
        message:
          'NPI is required when accepting Delta Dental, Cigna, or MetLife — the rep needs it to look up the claim.',
      });
    }
  });

export type OnboardingFormValues = z.infer<typeof OnboardingFormSchema>;
