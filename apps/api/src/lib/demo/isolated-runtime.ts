/* eslint-disable security/detect-non-literal-fs-filename -- Paths are trusted project files or descendants of this helper's private temporary directory. */
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const maximumSchemaBytes = 1024 * 1024;

export class IsolatedDemoRuntimeError extends Error {
  public readonly code = 'DEMO_ISOLATED_RUNTIME_FAILED';

  public constructor(
    public readonly stage:
      | 'PREPARE'
      | 'GENERATE'
      | 'VERIFY'
      | 'CLIENT_METADATA'
      | 'CLIENT_RUNTIME'
      | 'LOGGER'
      | 'BUNDLE' = 'PREPARE',
  ) {
    super('DEMO_ISOLATED_RUNTIME_FAILED');
    this.name = 'IsolatedDemoRuntimeError';
  }
}

export interface IsolatedDemoRuntime {
  readonly directory: string;
  readonly entryPath: string;
  dispose(): Promise<void>;
}

export interface PrepareIsolatedDemoRuntimeInput {
  readonly projectRoot: string;
  /** Trusted caller-owned JavaScript, never user-provided executable text. */
  readonly entrySource: string;
  /** The caller must first validate its complete environment with the demo policy. */
  readonly environment: Readonly<Record<string, string | undefined>>;
}

async function readSchema(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size === 0 || stat.size > maximumSchemaBytes) throw new Error();
    const buffer = Buffer.alloc(maximumSchemaBytes + 1);
    let offset = 0;
    while (offset <= maximumSchemaBytes) {
      const result = await file.read(buffer, offset, buffer.length - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    if (offset === 0 || offset > maximumSchemaBytes) throw new Error();
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset));
  } finally {
    await file.close();
  }
}

async function assertNoDotenv(directory: string): Promise<void> {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.name === '.env' || item.name.startsWith('.env.')) throw new Error();
    if (item.isDirectory()) await assertNoDotenv(join(directory, item.name));
  }
}

/** Prisma omits undefined paths; only recognized absent/null paths can avoid dotenv loading. */
export function assertIsolatedPrismaMetadata(generated: string): void {
  const matches = [...generated.matchAll(/"relativeEnvPaths"\s*:\s*(\{[^{}]*\})/g)];
  if (matches.length !== 1 || !matches[0]?.[1])
    throw new IsolatedDemoRuntimeError('CLIENT_METADATA');
  let paths: unknown;
  try {
    paths = JSON.parse(matches[0][1]);
  } catch {
    throw new IsolatedDemoRuntimeError('CLIENT_METADATA');
  }
  if (
    typeof paths !== 'object' ||
    paths === null ||
    Array.isArray(paths) ||
    Object.entries(paths).some(
      ([key, value]) => !['rootEnvPath', 'schemaEnvPath'].includes(key) || value !== null,
    )
  )
    throw new IsolatedDemoRuntimeError('CLIENT_METADATA');
}

async function assertPrivateClient(clientDirectory: string): Promise<void> {
  assertIsolatedPrismaMetadata(await readFile(join(clientDirectory, 'index.js'), 'utf8'));
  if (!(await lstat(join(clientDirectory, 'runtime', 'library.js'))).isFile())
    throw new IsolatedDemoRuntimeError('CLIENT_RUNTIME');
}

/** Builds an isolated executable but never starts it, connects to a DB, or loads app modules. */
export async function prepareIsolatedDemoRuntime(
  input: PrepareIsolatedDemoRuntimeInput,
): Promise<IsolatedDemoRuntime> {
  let directory: string | undefined;
  let stage: IsolatedDemoRuntimeError['stage'] = 'PREPARE';
  try {
    if (!isAbsolute(input.projectRoot) || !input.entrySource || input.entrySource.length > 65536) {
      throw new Error();
    }
    const projectRoot = await realpath(input.projectRoot);
    const databaseUrl = input.environment.DATABASE_URL;
    if (!databaseUrl) throw new Error();
    const dbRequire = createRequire(join(projectRoot, 'packages/db/package.json'));
    const prismaCli = dbRequire.resolve('prisma/build/index.js');
    const clientPackage = dirname(dbRequire.resolve('@prisma/client/package.json'));
    const enginePackage = dirname(createRequire(prismaCli).resolve('@prisma/engines/package.json'));
    const engines = await readdir(enginePackage);
    const queryEngines = engines.filter((name) => /^libquery_engine-.*\.node$/.test(name));
    const schemaEngines = engines.filter((name) => /^schema-engine-[^.]+(?:\.exe)?$/.test(name));
    const [queryEngine] = queryEngines;
    const [schemaEngine] = schemaEngines;
    if (queryEngines.length !== 1 || schemaEngines.length !== 1 || !queryEngine || !schemaEngine)
      throw new Error();
    const sourceSchema = await readSchema(join(projectRoot, 'packages/db/prisma/schema.prisma'));
    const generators = [...sourceSchema.matchAll(/^[\t ]*generator\s+\w+\s*\{[^}]*\}/gm)];
    if (
      generators.length !== 1 ||
      !generators[0] ||
      !/provider\s*=\s*"prisma-client-js"/.test(generators[0][0])
    ) {
      throw new Error();
    }

    directory = await mkdtemp(join(tmpdir(), 'dentabill-isolated-demo-'));
    await chmod(directory, 0o700);
    const generatorDirectory = join(directory, 'generator');
    const generatorModules = join(generatorDirectory, 'node_modules', '@prisma');
    const clientDirectory = join(directory, 'node_modules', '@prisma', 'client');
    await mkdir(generatorModules, { recursive: true });
    // Resolve the pinned generator without auto-installing or loading the original generated client.
    await symlink(clientPackage, join(generatorModules, 'client'), 'dir');
    await writeFile(join(directory, 'package.json'), '{"private":true,"type":"module"}\n', {
      mode: 0o600,
    });
    const schema = sourceSchema.replace(
      generators[0][0],
      [
        'generator client {',
        '  provider = "prisma-client-js"',
        '  output = "../node_modules/@prisma/client"',
        '  binaryTargets = ["native"]',
        '}',
      ].join('\n'),
    );
    const schemaPath = join(generatorDirectory, 'schema.prisma');
    await writeFile(schemaPath, schema, { mode: 0o600 });
    await assertNoDotenv(directory);
    stage = 'GENERATE';
    await execute(process.execPath, [prismaCli, 'generate', '--schema', schemaPath], {
      cwd: directory,
      env: {
        ...(input.environment.PATH ? { PATH: input.environment.PATH } : {}),
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'development',
        CHECKPOINT_DISABLE: '1',
        PRISMA_HIDE_UPDATE_MESSAGE: '1',
        PRISMA_GENERATE_SKIP_AUTOINSTALL: 'true',
        PRISMA_SCHEMA_ENGINE_BINARY: join(enginePackage, schemaEngine),
        PRISMA_QUERY_ENGINE_LIBRARY: join(enginePackage, queryEngine),
        NEXT_TELEMETRY_DISABLED: '1',
      },
      timeout: 60000,
      maxBuffer: 128 * 1024,
      windowsHide: true,
    });
    await rm(join(generatorDirectory, 'node_modules'), { recursive: true, force: true });
    stage = 'VERIFY';
    await assertPrivateClient(clientDirectory);
    await assertNoDotenv(directory);

    stage = 'LOGGER';
    const loggerRequire = createRequire(join(projectRoot, 'packages/logger/package.json'));
    for (const name of ['pino', 'pino-pretty']) {
      const packageDirectory = dirname(loggerRequire.resolve(`${name}/package.json`));
      await symlink(packageDirectory, join(directory, 'node_modules', name), 'dir');
    }
    const entryPath = join(directory, 'entry.mjs');
    stage = 'BUNDLE';
    const buildOptions = {
      stdin: {
        contents: input.entrySource,
        resolveDir: projectRoot,
        sourcefile: 'demo-isolated-entry.js',
        loader: 'js',
      },
      absWorkingDir: projectRoot,
      outfile: entryPath,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      external: ['@prisma/client', 'pino', 'pino-pretty'],
      logLevel: 'silent',
      legalComments: 'none',
      banner: {
        js: [
          "import { createRequire as __demoCreateRequire } from 'node:module';",
          "import { fileURLToPath as __demoFileURLToPath } from 'node:url';",
          "import { dirname as __demoDirname } from 'node:path';",
          'const require = __demoCreateRequire(import.meta.url);',
          'const __filename = __demoFileURLToPath(import.meta.url);',
          'const __dirname = __demoDirname(__filename);',
        ].join('\n'),
      },
    };
    const esbuildPath = createRequire(join(projectRoot, 'apps/api/package.json')).resolve(
      'esbuild',
    );
    const builderPath = join(directory, 'build.cjs');
    await writeFile(
      builderPath,
      `require(${JSON.stringify(esbuildPath)}).build(${JSON.stringify(buildOptions)}).catch(() => { process.exitCode = 1; });\n`,
      { mode: 0o600 },
    );
    await execute(process.execPath, [builderPath], {
      cwd: directory,
      env: {
        ...(input.environment.PATH ? { PATH: input.environment.PATH } : {}),
        NODE_ENV: 'development',
      },
      timeout: 60000,
      maxBuffer: 128 * 1024,
      windowsHide: true,
    });
    await rm(builderPath);
    const ownedDirectory = directory;
    return {
      directory: ownedDirectory,
      entryPath,
      dispose: async (): Promise<void> => {
        await rm(ownedDirectory, { recursive: true, force: true });
      },
    };
  } catch (error: unknown) {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw new IsolatedDemoRuntimeError(
      error instanceof IsolatedDemoRuntimeError ? error.stage : stage,
    );
  }
}
