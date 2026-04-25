# `@dentabill/config`

Shared TypeScript, ESLint, Prettier, and Vitest configuration for every
workspace in the DentaBill monorepo.

## What's here

| File                    | Purpose                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| `tsconfig.base.json`    | Strict TS compiler options, common to every workspace.           |
| `tsconfig.lib.json`     | Node-targeted packages (`module: NodeNext`).                     |
| `tsconfig.app.json`     | Next.js / browser apps (`module: ESNext`, `Bundler` resolution). |
| `eslint.config.js`      | Flat config — typescript-eslint strict + import + security.      |
| `prettier.config.js`    | 100-char, single quotes, trailing comma all, semicolons.         |
| `vitest.config.base.ts` | 80% coverage thresholds (per `docs/ENGINEERING_RULES.md`).       |

## Consuming this package

Add as a dev dependency in the consumer workspace:

```jsonc
// packages/<name>/package.json
{
  "devDependencies": {
    "@dentabill/config": "workspace:*",
  },
}
```

Then reference each config file:

```jsonc
// packages/<name>/tsconfig.json
{
  "extends": "@dentabill/config/tsconfig.lib.json",
  "include": ["src/**/*"],
}
```

```js
// packages/<name>/eslint.config.js
export { default } from '@dentabill/config/eslint';
```

```js
// packages/<name>/prettier.config.js
export { default } from '@dentabill/config/prettier';
```

```ts
// packages/<name>/vitest.config.ts
import { mergeConfig, defineConfig } from 'vitest/config';
import base from '@dentabill/config/vitest';

export default mergeConfig(base, defineConfig({}));
```

## Verification

```bash
pnpm --filter @dentabill/config lint
pnpm --filter @dentabill/config typecheck
pnpm --filter @dentabill/config test
```
