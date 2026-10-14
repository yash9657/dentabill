import { execFile, type ExecFileException } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  DemoPreflightError,
  DemoPreflightReportSchema,
  isolatedDemoEnvironment,
  validateDemoConfiguration,
  type DemoPreflightConfiguration,
  type DemoPreflightReport,
} from './preflight-policy.js';
import {
  DemoProvisionDatabaseResultSchema,
  type DemoProvisionDatabaseResult,
} from './provision-contract.js';

type Operation = 'preflight' | 'provision';
type Report = DemoPreflightReport | DemoProvisionDatabaseResult;

function succeeded(report: Report): boolean {
  return report.status === 'PREFLIGHT_PASSED' || report.status === 'PROVISIONED';
}

export function decodeDemoCommandReport(
  operation: Operation,
  stdout: string,
  stderr: string,
  error: Pick<ExecFileException, 'code'> | null,
): Report {
  try {
    if (stderr !== '' || (error && error.code !== 1)) throw new Error();
    const raw: unknown = JSON.parse(stdout);
    const report =
      operation === 'preflight'
        ? DemoPreflightReportSchema.parse(raw)
        : DemoProvisionDatabaseResultSchema.parse(raw);
    if (Boolean(error) === succeeded(report)) throw new Error();
    return report;
  } catch {
    throw new DemoPreflightError('DEMO_ISOLATED_RUNTIME_FAILED');
  }
}

export function demoCommandFailure(input: {
  operation: Operation;
  error: unknown;
  childStarted: boolean;
  configuration?: DemoPreflightConfiguration | undefined;
  provisionId?: string | undefined;
}): Report {
  const code =
    input.error instanceof DemoPreflightError ? input.error.code : 'DEMO_PREFLIGHT_FAILED';
  if (input.operation === 'preflight') return { status: 'PREFLIGHT_FAILED', code };
  return {
    status: 'PROVISION_FAILED',
    code: input.childStarted ? 'DEMO_PROVISION_OUTCOME_UNKNOWN' : code,
    phase: input.childStarted ? 'UNKNOWN' : 'VALIDATE',
    databaseState: input.childStarted ? 'OUTCOME_UNKNOWN' : 'NOT_CREATED',
    ...(input.provisionId ? { provisionId: input.provisionId } : {}),
    ...(input.configuration ? { databaseName: input.configuration.databaseName } : {}),
  };
}

async function writeReport(report: Report): Promise<void> {
  const stream = succeeded(report) ? process.stdout : process.stderr;
  await new Promise<void>((resolve, reject) => {
    const onError = (): void => {
      reject(new Error('DEMO_REPORT_WRITE_FAILED'));
    };
    stream.once('error', onError);
    stream.write(JSON.stringify(report) + '\n', (error) => {
      if (error) {
        reject(new Error('DEMO_REPORT_WRITE_FAILED'));
      } else {
        stream.removeListener('error', onError);
        resolve();
      }
    });
  });
}

async function executePrivateRuntime(input: {
  operation: Operation;
  directory: string;
  entryPath: string;
  schemaPath: string;
  environment: Record<string, string>;
}): Promise<Report> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ['--no-warnings', input.entryPath, input.schemaPath],
      {
        cwd: input.directory,
        env: input.environment,
        timeout: input.operation === 'provision' ? 180000 : 60000,
        maxBuffer: 64 * 1024,
      },
      (error, stdout, stderr) => {
        try {
          resolve(decodeDemoCommandReport(input.operation, stdout, stderr, error));
        } catch {
          reject(new DemoPreflightError('DEMO_ISOLATED_RUNTIME_FAILED'));
        }
      },
    );
  });
}

export function parseDemoActorArguments(): { help: boolean; actor: unknown } {
  try {
    const { values } = parseArgs({
      options: {
        'organization-id': { type: 'string' },
        'user-id': { type: 'string' },
        'clerk-organization-id': { type: 'string' },
        'clerk-user-id': { type: 'string' },
        help: { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    });
    return {
      help: values.help === true,
      actor: {
        organizationId: values['organization-id'],
        userId: values['user-id'],
        clerkOrganizationId: values['clerk-organization-id'],
        clerkUserId: values['clerk-user-id'],
      },
    };
  } catch {
    throw new DemoPreflightError('DEMO_ARGUMENTS_INVALID');
  }
}

export async function runDemoCli(operation: Operation, scriptUrl: string): Promise<void> {
  let configuration: DemoPreflightConfiguration | undefined;
  let provisionId: string | undefined;
  let childStarted = false;
  try {
    const { actor, help } = parseDemoActorArguments();
    if (help) {
      process.stdout.write(
        (operation === 'preflight'
          ? 'Read-only synthetic demo preflight.'
          : 'Create-only synthetic demo provisioning. Existing databases are always refused.') +
          ' See DEMO.md for explicit environment requirements.\n' +
          `Usage: demo-${operation} --organization-id ID --user-id ID ` +
          '--clerk-organization-id org_ID --clerk-user-id user_ID\n',
      );
      return;
    }
    configuration = validateDemoConfiguration(process.env, actor);
    const environment = isolatedDemoEnvironment(process.env, configuration.actor);
    const projectRoot = fileURLToPath(new URL('../../../', scriptUrl));
    const commandPath = join(projectRoot, `apps/api/src/lib/demo/${operation}-command.ts`);
    const functionName = operation === 'preflight' ? 'runDemoPreflight' : 'runDemoProvision';
    provisionId = operation === 'provision' ? randomUUID() : undefined;
    const argumentsSource = [
      JSON.stringify(projectRoot),
      'process.env',
      JSON.stringify(configuration.actor),
      ...(operation === 'provision' ? ['process.argv[2]', JSON.stringify(provisionId)] : []),
    ].join(', ');
    const { prepareIsolatedDemoRuntime } = await import('./isolated-runtime.js');
    const runtime = await prepareIsolatedDemoRuntime({
      projectRoot,
      environment,
      entrySource: [
        `import { ${functionName} } from ${JSON.stringify(commandPath)};`,
        `const report = await ${functionName}(${argumentsSource});`,
        'process.stdout.write(JSON.stringify(report) + "\\n");',
        'process.exitCode = ["PREFLIGHT_PASSED", "PROVISIONED"].includes(report.status) ? 0 : 1;',
      ].join('\n'),
    }).catch(() => {
      throw new DemoPreflightError('DEMO_ISOLATED_RUNTIME_FAILED');
    });
    let report: Report;
    try {
      childStarted = true;
      report = await executePrivateRuntime({ operation, environment, ...runtime });
    } finally {
      await runtime.dispose();
    }
    await writeReport(report);
    process.exitCode = succeeded(report) ? 0 : 1;
  } catch (error: unknown) {
    const report = demoCommandFailure({
      operation,
      error,
      childStarted,
      configuration,
      provisionId,
    });
    await writeReport(report).catch(() => undefined);
    process.exitCode = 1;
  }
}
