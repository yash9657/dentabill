import importPlugin from 'eslint-plugin-import';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import securityPlugin from 'eslint-plugin-security';
import tseslint from 'typescript-eslint';

/**
 * Shared DentaBill ESLint flat config.
 *
 * Consumers import this from `@dentabill/config/eslint` and may extend it with
 * project-specific overrides (e.g. React/Next.js rules in `apps/web`).
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/node_modules/**',
      // Config files at any depth, including multi-dot variants like vitest.config.base.js
      '**/*.config.{js,mjs,cjs,ts}',
      '**/*.config.*.{js,mjs,cjs,ts}',
      '**/vitest.workspace.{ts,js,mjs}',
      // Next.js auto-generates this on every dev/build — any local edits get
      // wiped, so linting it would be a no-op or worse, a perpetual fail.
      '**/next-env.d.ts',
      // Build / CI helper scripts authored in plain Node ESM. They aren't
      // application code, don't ship to users, and don't have a TS project
      // service available — so linting them with the typed-checked rules
      // produces parse-error noise. They still go through prettier.
      '**/scripts/**/*.mjs',
      // Third-party Claude Code skill bundles — vendored, not authored here.
      '.claude/skills/impeccable/**',
    ],
  },
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    plugins: {
      import: importPlugin,
      security: securityPlugin,
    },
    settings: {
      'import/resolver': {
        typescript: { alwaysTryTypes: true },
      },
    },
    rules: {
      // DentaBill engineering rules — ENGINEERING_RULES.md
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      'no-console': ['error', { allow: ['error'] }],

      // Cross-package imports must use workspace names, never relative `../../`
      'import/no-relative-packages': 'error',
      'import/no-cycle': 'error',
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],

      // Security plugin — keep noisy rules off, sharp ones on
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-eval-with-expression': 'error',
      'security/detect-unsafe-regex': 'error',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-non-literal-regexp': 'warn',
    },
  },
  {
    // Tests may use console for diagnostics and don't need explicit return types.
    // Also covers .tsx test files written with @testing-library/react.
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/__tests__/**'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    /**
     * React + JSX surface — apps/web and packages/ui.
     *
     * Combines:
     *   - `eslint-plugin-jsx-a11y` recommended (ADR-021 WCAG 2.2 AA gate),
     *     with three extra rules elevated to `error`.
     *   - `eslint-plugin-react` recommended via its `flat.recommended`
     *     export, with `react-in-jsx-scope` / `jsx-uses-react` /
     *     `prop-types` off (Next.js + TSX, not legacy CRA).
     *   - `eslint-plugin-react-hooks` recommended (no flat export — wire
     *     via `plugins` + `rules` directly).
     *
     * NOT wired: `eslint-plugin-tailwindcss`. Its v3 line cannot load
     * Tailwind v4 CSS-first configs without `tailwindcss` itself being a
     * dep of this package, and v4-native ESLint plugins are still
     * pre-1.0. Class ordering is delegated to `prettier-plugin-tailwindcss`
     * (registered in `prettier.config.js`); class deduplication is
     * delegated to twMerge at runtime via `cn()`. Revisit ADR-015 once a
     * stable Tailwind-v4-native plugin lands.
     */
    files: ['**/*.{tsx,jsx}'],
    plugins: {
      'jsx-a11y': jsxA11yPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...jsxA11yPlugin.configs.recommended.rules,
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/no-autofocus': 'error',
      'jsx-a11y/no-redundant-roles': 'error',

      ...reactPlugin.configs.flat.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',
      'react/prop-types': 'off',
    },
  },
);
