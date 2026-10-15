import { describe, expect, it } from 'vitest';

import { validateCallIdentity } from './call-identity.js';

describe('validateCallIdentity', () => {
  it.each([undefined, null, '', ' \t\n '])(
    'blocks absent or blank subscriber ID: %j',
    (subscriberId) => {
      expect(validateCallIdentity({ subscriberId, providerNpi: '1234567890' })).toEqual({
        ok: false,
        code: 'MISSING_CALL_IDENTITY',
        missingFields: ['subscriberId'],
      });
    },
  );

  it.each([undefined, null, '', ' \t\n '])(
    'blocks absent or blank provider NPI: %j',
    (providerNpi) => {
      expect(validateCallIdentity({ subscriberId: 'MEMBER-123', providerNpi })).toEqual({
        ok: false,
        code: 'MISSING_CALL_IDENTITY',
        missingFields: ['providerNpi'],
      });
    },
  );

  it('returns only missing field names, without disclosing present identity values', () => {
    expect(validateCallIdentity({ subscriberId: null, providerNpi: null })).toEqual({
      ok: false,
      code: 'MISSING_CALL_IDENTITY',
      missingFields: ['subscriberId', 'providerNpi'],
    });
  });

  it('preserves the actual identifiers and removes surrounding import whitespace', () => {
    expect(
      validateCallIdentity({ subscriberId: ' MEMBER-123 ', providerNpi: ' 1234567890 ' }),
    ).toEqual({
      ok: true,
      identity: { subscriberId: 'MEMBER-123', providerNpi: '1234567890' },
    });
  });
});
