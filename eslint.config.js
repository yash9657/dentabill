import base from '@dentabill/config/eslint';

export default [
  ...base,
  {
    // Motion code builds CSS transforms from numbers on every line.
    files: ['apps/demo-film/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
];
