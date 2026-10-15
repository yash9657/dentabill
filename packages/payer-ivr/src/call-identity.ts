export type MissingCallIdentityField = 'subscriberId' | 'providerNpi';

export interface CallIdentity {
  readonly subscriberId: string;
  readonly providerNpi: string;
}

export type CallIdentityValidation =
  | { readonly ok: true; readonly identity: CallIdentity }
  | {
      readonly ok: false;
      readonly code: 'MISSING_CALL_IDENTITY';
      readonly missingFields: readonly MissingCallIdentityField[];
    };

/** Minimum identity required by all currently configured payer IVR maps. */
export function validateCallIdentity(input: {
  readonly subscriberId: string | null | undefined;
  readonly providerNpi: string | null | undefined;
}): CallIdentityValidation {
  const subscriberId = input.subscriberId?.trim() ?? '';
  const providerNpi = input.providerNpi?.trim() ?? '';
  const missingFields: MissingCallIdentityField[] = [];
  if (subscriberId.length === 0) missingFields.push('subscriberId');
  if (providerNpi.length === 0) missingFields.push('providerNpi');
  if (missingFields.length > 0) {
    return { ok: false, code: 'MISSING_CALL_IDENTITY', missingFields };
  }
  return { ok: true, identity: { subscriberId, providerNpi } };
}
