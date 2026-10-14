#!/usr/bin/env tsx
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  DemoPreflightError,
  DemoPreflightReportSchema,
  isolatedDemoEnvironment,
  validateDemoConfiguration,
  type DemoPreflightReport,
} from '../src/lib/demo/preflight-policy.js';

async function executePrivateRuntime(
  directory: string,
  entryPath: string,
  environment: Record<string, string>,
): Promise<DemoPreflightReport> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ['--no-warnings', entryPath],
      { cwd: directory, env: environment, timeout: 60000, maxBuffer: 64 * 1024 },
      (error, stdout, stderr) => {
        try {
          if (stderr !== '' || (error && error.code !== 1)) throw new Error();
          const result = DemoPreflightReportSchema.parse(JSON.parse(stdout) as unknown);
          if (Boolean(error) !== (result.status === 'PREFLIGHT_FAILED')) throw new Error();
          resolve(result);
        } catch {
          reject(new DemoPreflightError('DEMO_ISOLATED_RUNTIME_FAILED'));
        }
      },
    );
  });
}

async function main(): Promise<void> {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      options: {
        'organization-id': { type: 'string' },
        'user-id': { type: 'string' },
        'clerk-organization-id': { type: 'string' },
        'clerk-user-id': { type: 'string' },
        help: { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    throw new DemoPreflightError('DEMO_ARGUMENTS_INVALID');
  }
  if (values.help) {
    process.stdout.write(
      'Read-only synthetic demo preflight. See DEMO.md for explicit environment requirements.\n' +
        'Usage: demo-preflight --organization-id ID --user-id ID ' +
        '--clerk-organization-id org_ID --clerk-user-id user_ID\n',
    );
    return;
  }

  const configuration = validateDemoConfiguration(process.env, {
    organizationId: values['organization-id'],
    userId: values['user-id'],
    clerkOrganizationId: values['clerk-organization-id'],
    clerkUserId: values['clerk-user-id'],
  });
  const environment = isolatedDemoEnvironment(process.env, configuration.actor);
  const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const commandPath = join(projectRoot, 'apps/api/src/lib/demo/preflight-command.ts');
  const { prepareIsolatedDemoRuntime, IsolatedDemoRuntimeError } =
    await import('../src/lib/demo/isolated-runtime.js');
  try {
    const runtime = await prepareIsolatedDemoRuntime({
      projectRoot,
      environment,
      entrySource: [
        `import { runDemoPreflight } from ${JSON.stringify(commandPath)};`,
        `const report = await runDemoPreflight(${JSON.stringify(projectRoot)}, process.env, ${JSON.stringify(configuration.actor)});`,
        'process.stdout.write(JSON.stringify(report) + "\\n");',
        'process.exitCode = report.status === "PREFLIGHT_PASSED" ? 0 : 1;',
      ].join('\n'),
    });
    let report: DemoPreflightReport;
    try {
      report = await executePrivateRuntime(runtime.directory, runtime.entryPath, environment);
    } finally {
      await runtime.dispose();
    }
    const output = report.status === 'PREFLIGHT_PASSED' ? process.stdout : process.stderr;
    output.write(JSON.stringify(report) + '\n');
    process.exitCode = report.status === 'PREFLIGHT_PASSED' ? 0 : 1;
  } catch (error: unknown) {
    if (error instanceof IsolatedDemoRuntimeError) {
      throw new DemoPreflightError('DEMO_ISOLATED_RUNTIME_FAILED');
    }
    throw error;
  }
}

main().catch((error: unknown) => {
  const code = error instanceof DemoPreflightError ? error.code : 'DEMO_PREFLIGHT_FAILED';
  process.stderr.write(JSON.stringify({ status: 'PREFLIGHT_FAILED', code }) + '\n');
  process.exitCode = 1;
});
