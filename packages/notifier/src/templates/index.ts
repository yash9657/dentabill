import { z } from 'zod';

/**
 * Templates the notifier accepts. Each entry is a strict Zod schema
 * describing the variables that template renders against.
 *
 * **PHI rule (load-bearing).** Templates MUST NOT accept patient name,
 * DOB, SSN, or full diagnosis. Use `claimNumber + payer + serviceDate`
 * to identify a claim. Adding a new field here without revisiting
 * `docs/SECURITY.md` Phase-4 entries is a HIPAA-compliance regression.
 */

export const ClaimResolvedTemplate = z
  .object({
    claimNumber: z.string().min(1),
    payerCode: z.string().min(1),
    serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'serviceDate must be ISO YYYY-MM-DD'),
    amountResolvedCents: z.number().int().min(0),
  })
  .strict();
export type ClaimResolvedVars = z.infer<typeof ClaimResolvedTemplate>;

export const ClaimNeedsInfoTemplate = z
  .object({
    claimNumber: z.string().min(1),
    payerCode: z.string().min(1),
    serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'serviceDate must be ISO YYYY-MM-DD'),
    /** Free-text "what to attach" hint from the summarizer. PHI-screened. */
    hint: z.string().min(1).max(280),
  })
  .strict();
export type ClaimNeedsInfoVars = z.infer<typeof ClaimNeedsInfoTemplate>;

export const ClaimDeniedTemplate = z
  .object({
    claimNumber: z.string().min(1),
    payerCode: z.string().min(1),
    serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'serviceDate must be ISO YYYY-MM-DD'),
    denialCode: z.string().min(1),
  })
  .strict();
export type ClaimDeniedVars = z.infer<typeof ClaimDeniedTemplate>;

export const SummaryDlqTemplate = z
  .object({
    callId: z.string().min(1),
    claimNumber: z.string().min(1),
    /** Short reason — schema-validation failure path or unknown denial code. */
    reason: z.string().min(1).max(280),
  })
  .strict();
export type SummaryDlqVars = z.infer<typeof SummaryDlqTemplate>;

export const TEMPLATES = {
  'claim.resolved': ClaimResolvedTemplate,
  'claim.needs_info': ClaimNeedsInfoTemplate,
  'claim.denied': ClaimDeniedTemplate,
  'summary.dlq': SummaryDlqTemplate,
} as const;

export type TemplateName = keyof typeof TEMPLATES;
export type TemplateVars<T extends TemplateName> = z.infer<(typeof TEMPLATES)[T]>;
