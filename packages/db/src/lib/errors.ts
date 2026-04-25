/**
 * Errors thrown by the multi-tenancy enforcement layers in @dentabill/db.
 * Catch these in application code to surface them as structured ApiError
 * responses (`ORG_SCOPE_MISSING` or `ORG_SCOPE_VIOLATION`).
 */

export class MissingOrgScopeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MissingOrgScopeError';
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public static is(value: unknown): value is MissingOrgScopeError {
    return value instanceof MissingOrgScopeError;
  }
}
