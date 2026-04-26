import { z } from 'zod';

/**
 * Shared Zod schema for the /contact form.
 *
 * Lives in `lib/` rather than alongside the component or the route
 * handler so both sides of the wire (the client form, the server
 * route, and any future test fixtures) reach for the same source of
 * truth. Same-package wiring keeps the schema co-located with the
 * web app's edge runtime; when the form moves to the real API in
 * `apps/api` this file is the single thing that needs to be
 * relocated and re-exported.
 *
 * Field choices are deliberately small. A long contact form is the
 * fastest way to lose a real prospect; we ask for the four things
 * we actually want to read before replying:
 *
 *   - name + work email so we know who to write back to.
 *   - practice name so we can search for it before the call.
 *   - claim volume bucket so we know which pricing tier this is.
 *   - free-form message so the prospect can ask the actual question.
 */
export const CLAIMS_PER_WEEK_BUCKETS = [
  'Under 25',
  '25 to 100',
  '100 to 500',
  '500 or more',
] as const;

export type ClaimsPerWeekBucket = (typeof CLAIMS_PER_WEEK_BUCKETS)[number];

export const ContactFormSchema = z.object({
  name: z.string().trim().min(2, 'Tell us your name.').max(120, 'Name is too long.'),
  email: z.string().trim().email('Enter a valid work email.').max(254, 'Email is too long.'),
  practiceName: z
    .string()
    .trim()
    .min(2, 'Tell us the practice name.')
    .max(160, 'Practice name is too long.'),
  claimsPerWeek: z.enum(CLAIMS_PER_WEEK_BUCKETS, {
    message: 'Pick a claim volume bucket.',
  }),
  message: z
    .string()
    .trim()
    .min(20, 'Add at least a sentence so we know what to talk about.')
    .max(2000, 'Trim the message to 2000 characters.'),
});

export type ContactFormValues = z.infer<typeof ContactFormSchema>;
