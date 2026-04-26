import { describe, expect, it } from 'vitest';

import {
  normalisePayerName,
  payerCodeLabel,
  resolvePayerCode,
  SUPPORTED_PAYER_CODES,
} from './payer-codes.js';

describe('normalisePayerName', () => {
  it('lowercases, collapses whitespace, and strips punctuation', () => {
    expect(normalisePayerName('Delta Dental, PPO')).toBe('delta dental ppo');
    expect(normalisePayerName('  DELTA   DENTAL   PPO  ')).toBe('delta dental ppo');
    expect(normalisePayerName('delta-dental-ppo')).toBe('delta dental ppo');
    expect(normalisePayerName('Cigna / Dental')).toBe('cigna dental');
  });

  it('returns empty string for empty / whitespace input', () => {
    expect(normalisePayerName('')).toBe('');
    expect(normalisePayerName('   ')).toBe('');
  });
});

describe('resolvePayerCode', () => {
  it.each([
    ['Delta Dental PPO', 'DELTA_DENTAL_PPO'],
    ['DELTA DENTAL OF CA - PPO', 'DELTA_DENTAL_PPO'],
    ['Delta PPO', 'DELTA_DENTAL_PPO'],
    ['delta dental premier', 'DELTA_DENTAL_PREMIER'],
    ['Cigna Dental', 'CIGNA_DENTAL'],
    ['Cigna DPPO', 'CIGNA_DENTAL'],
    ['MetLife Dental', 'METLIFE_DENTAL'],
    ['Met Life', 'METLIFE_DENTAL'],
    ['Aetna PPO', 'AETNA_DENTAL'],
    ['Guardian Life Insurance', 'GUARDIAN_DENTAL'],
    ['United Concordia', 'UNITED_CONCORDIA'],
    ['Tricare Dental', 'UNITED_CONCORDIA'],
    ['Humana PPO', 'HUMANA_DENTAL'],
  ] as const)('maps %s to %s', (input, expected) => {
    const result = resolvePayerCode(input);
    expect(result.code).toBe(expected);
    expect(result.matched).toBe(true);
  });

  it('returns UNKNOWN for unmatched payers and preserves the original label verbatim', () => {
    const result = resolvePayerCode('Some Indie BCBS Plan');
    expect(result.code).toBe('UNKNOWN');
    expect(result.matched).toBe(false);
    expect(result.label).toBe('Some Indie BCBS Plan');
  });

  it('returns UNKNOWN with a stable label for empty / nullish input', () => {
    expect(resolvePayerCode(null)).toEqual({ code: 'UNKNOWN', label: 'Unknown', matched: false });
    expect(resolvePayerCode(undefined)).toEqual({
      code: 'UNKNOWN',
      label: 'Unknown',
      matched: false,
    });
    expect(resolvePayerCode('')).toEqual({ code: 'UNKNOWN', label: 'Unknown', matched: false });
    expect(resolvePayerCode('   ')).toEqual({ code: 'UNKNOWN', label: 'Unknown', matched: false });
  });

  it('is deterministic for upload-and-re-upload of the same row', () => {
    const a = resolvePayerCode('  Delta Dental PPO  ');
    const b = resolvePayerCode('Delta Dental PPO');
    expect(a).toEqual(b);
  });
});

describe('payerCodeLabel', () => {
  it('returns canonical display labels for known codes', () => {
    expect(payerCodeLabel('DELTA_DENTAL_PPO')).toBe('Delta Dental PPO');
    expect(payerCodeLabel('CIGNA_DENTAL')).toBe('Cigna Dental');
    expect(payerCodeLabel('UNKNOWN')).toBe('Unknown');
  });
});

describe('SUPPORTED_PAYER_CODES', () => {
  it('lists every PayerCode used by the lookup table plus UNKNOWN', () => {
    expect(SUPPORTED_PAYER_CODES).toContain('DELTA_DENTAL_PPO');
    expect(SUPPORTED_PAYER_CODES).toContain('UNKNOWN');
    expect(new Set(SUPPORTED_PAYER_CODES).size).toBe(SUPPORTED_PAYER_CODES.length);
  });
});
