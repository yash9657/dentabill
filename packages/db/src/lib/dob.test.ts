import { describe, expect, it } from 'vitest';

import { hashPatientDOB, patientDOBLast4 } from './dob.js';

const ORG = 'org_acme_dental';
const SECRET = 'a-strong-org-scoped-secret-not-the-real-one';

describe('hashPatientDOB', () => {
  it('returns a 64-char lowercase hex digest for valid input', () => {
    const digest = hashPatientDOB({ dob: '1990-05-12', organizationId: ORG, secret: SECRET });
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic across calls with identical inputs', () => {
    const a = hashPatientDOB({ dob: '1990-05-12', organizationId: ORG, secret: SECRET });
    const b = hashPatientDOB({ dob: '1990-05-12', organizationId: ORG, secret: SECRET });
    expect(a).toBe(b);
  });

  it('produces different digests for different DOBs (collision-resistant under tenant key)', () => {
    const a = hashPatientDOB({ dob: '1990-05-12', organizationId: ORG, secret: SECRET });
    const b = hashPatientDOB({ dob: '1990-05-13', organizationId: ORG, secret: SECRET });
    expect(a).not.toBe(b);
  });

  it('produces different digests for the same DOB across different organizations', () => {
    const a = hashPatientDOB({ dob: '1990-05-12', organizationId: 'org_a', secret: SECRET });
    const b = hashPatientDOB({ dob: '1990-05-12', organizationId: 'org_b', secret: SECRET });
    expect(a).not.toBe(b);
  });

  it('produces different digests with the same DOB + org but different secrets', () => {
    const a = hashPatientDOB({ dob: '1990-05-12', organizationId: ORG, secret: 'secret-one' });
    const b = hashPatientDOB({ dob: '1990-05-12', organizationId: ORG, secret: 'secret-two' });
    expect(a).not.toBe(b);
  });

  it('accepts Date instances and matches the ISO-string output', () => {
    const fromIso = hashPatientDOB({ dob: '1990-05-12', organizationId: ORG, secret: SECRET });
    const fromDate = hashPatientDOB({
      dob: new Date(Date.UTC(1990, 4, 12)),
      organizationId: ORG,
      secret: SECRET,
    });
    expect(fromDate).toBe(fromIso);
  });

  it('rejects non-ISO date strings (no silent normalisation)', () => {
    expect(() => hashPatientDOB({ dob: '5/12/1990', organizationId: ORG, secret: SECRET })).toThrow(
      /ISO YYYY-MM-DD/i,
    );
    expect(() => hashPatientDOB({ dob: '1990-5-12', organizationId: ORG, secret: SECRET })).toThrow(
      /ISO YYYY-MM-DD/i,
    );
    expect(() =>
      hashPatientDOB({ dob: ' 1990-05-12 ', organizationId: ORG, secret: SECRET }),
    ).toThrow(/ISO YYYY-MM-DD/i);
  });

  it('rejects Invalid Date instances', () => {
    expect(() =>
      hashPatientDOB({ dob: new Date('not-a-date'), organizationId: ORG, secret: SECRET }),
    ).toThrow(/Invalid Date/i);
  });

  it('rejects empty organizationId or secret', () => {
    expect(() => hashPatientDOB({ dob: '1990-05-12', organizationId: '', secret: SECRET })).toThrow(
      /organizationId/,
    );
    expect(() => hashPatientDOB({ dob: '1990-05-12', organizationId: ORG, secret: '' })).toThrow(
      /secret/,
    );
  });
});

describe('patientDOBLast4', () => {
  it('returns the four-digit birth year from an ISO date', () => {
    expect(patientDOBLast4('1990-05-12')).toBe('1990');
    expect(patientDOBLast4('2002-12-31')).toBe('2002');
  });

  it('returns the four-digit birth year from a Date', () => {
    expect(patientDOBLast4(new Date(Date.UTC(1990, 4, 12)))).toBe('1990');
  });

  it('rejects non-ISO date strings', () => {
    expect(() => patientDOBLast4('5/12/1990')).toThrow();
  });
});
