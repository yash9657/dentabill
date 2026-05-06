/**
 * Conventional Commits enforcement for DentaBill.
 *
 * Allowed types match `docs/ENGINEERING_RULES.md` (feat/fix/chore/docs/test).
 * Allowed scopes match the workspaces in `pnpm-workspace.yaml` plus
 * cross-cutting concerns (ci, deps, infra). Add a new scope here if it
 * applies repo-wide; per-package scopes can be added in subsequent tasks.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'chore', 'docs', 'test', 'refactor', 'perf', 'build', 'ci', 'revert'],
    ],
    'scope-enum': [
      2,
      'always',
      [
        // apps
        'web',
        'api',
        'call-worker',
        'summary-worker',
        'billing-worker',
        // packages
        'config',
        'db',
        'logger',
        'types',
        'queue',
        'payer-ivr',
        'summarizer',
        'billing',
        'notifier',
        'ui',
        // cross-cutting
        'monorepo',
        'ci',
        'deps',
        'docs',
        'claude',
        'infra',
        'security',
        'release',
      ],
    ],
    'scope-empty': [2, 'never'],
    // Allow task IDs (P1-T2A) and acronyms. Block ALL-CAPS or PascalCase.
    'subject-case': [2, 'never', ['pascal-case', 'upper-case']],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 100],
  },
};
