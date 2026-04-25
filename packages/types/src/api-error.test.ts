import { describe, expect, it } from 'vitest';

import { API_ERROR_CODES, ApiError, ApiErrorSchema, httpStatusForCode } from './api-error.js';

describe('ApiErrorSchema', () => {
  it('parses a valid wire payload', () => {
    const payload = { error: true, message: 'invalid input', code: 'VALIDATION_ERROR' };
    expect(ApiErrorSchema.parse(payload)).toEqual(payload);
  });

  it('rejects payloads missing error: true', () => {
    expect(() =>
      ApiErrorSchema.parse({ error: false, message: 'x', code: 'INTERNAL_ERROR' }),
    ).toThrow();
  });

  it('rejects empty message or code', () => {
    expect(() =>
      ApiErrorSchema.parse({ error: true, message: '', code: 'INTERNAL_ERROR' }),
    ).toThrow();
    expect(() => ApiErrorSchema.parse({ error: true, message: 'x', code: '' })).toThrow();
  });
});

describe('httpStatusForCode', () => {
  it('maps known codes to canonical HTTP statuses', () => {
    expect(httpStatusForCode(API_ERROR_CODES.VALIDATION_ERROR)).toBe(400);
    expect(httpStatusForCode(API_ERROR_CODES.AUTHENTICATION_REQUIRED)).toBe(401);
    expect(httpStatusForCode(API_ERROR_CODES.FORBIDDEN)).toBe(403);
    expect(httpStatusForCode(API_ERROR_CODES.NOT_FOUND)).toBe(404);
    expect(httpStatusForCode(API_ERROR_CODES.CONFLICT)).toBe(409);
    expect(httpStatusForCode(API_ERROR_CODES.RATE_LIMITED)).toBe(429);
    expect(httpStatusForCode(API_ERROR_CODES.INTERNAL_ERROR)).toBe(500);
    expect(httpStatusForCode(API_ERROR_CODES.ORG_SCOPE_MISSING)).toBe(403);
    expect(httpStatusForCode(API_ERROR_CODES.ORG_SCOPE_VIOLATION)).toBe(403);
    expect(httpStatusForCode(API_ERROR_CODES.WEBHOOK_SIGNATURE_INVALID)).toBe(401);
  });

  it('falls back to 500 for unknown codes', () => {
    expect(httpStatusForCode('UNREGISTERED_CODE')).toBe(500);
  });
});

describe('ApiError', () => {
  it('serializes via toJson() in the wire format', () => {
    const err = new ApiError('VALIDATION_ERROR', 'organizationId is required');
    expect(err.toJson()).toEqual({
      error: true,
      message: 'organizationId is required',
      code: 'VALIDATION_ERROR',
    });
    expect(ApiErrorSchema.parse(err.toJson())).toBeDefined();
  });

  it('exposes the canonical HTTP status', () => {
    expect(new ApiError('NOT_FOUND', 'claim missing').statusCode).toBe(404);
    expect(new ApiError('INTERNAL_ERROR', 'oops').statusCode).toBe(500);
  });

  it('is identifiable via isApiError', () => {
    expect(ApiError.isApiError(new ApiError('CONFLICT', 'x'))).toBe(true);
    expect(ApiError.isApiError(new Error('plain'))).toBe(false);
    expect(ApiError.isApiError({ message: 'x' })).toBe(false);
    expect(ApiError.isApiError(null)).toBe(false);
  });

  it('preserves the prototype across throw + catch', () => {
    try {
      throw new ApiError('FORBIDDEN', 'denied');
    } catch (caught) {
      expect(caught).toBeInstanceOf(ApiError);
      expect(ApiError.isApiError(caught)).toBe(true);
    }
  });
});
