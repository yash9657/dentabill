/**
 * Verification fixture for `@dentabill/config`. Must typecheck under
 * `tsconfig.lib.json` and lint clean against `eslint.config.js`.
 */
export function add(a: number, b: number): number {
  return a + b;
}

export type Sum = ReturnType<typeof add>;
