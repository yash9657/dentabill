#!/usr/bin/env tsx
/**
 * provision-retell.mts — idempotently provision the Retell LLM + Agent
 * resources for every Phase-3 dialable payer, plus optionally bind an
 * outbound phone number.
 *
 * One-shot, run-from-laptop replacement for clicking through the
 * Retell dashboard. Source-of-truth is `packages/payer-ivr/src/agents/*`
 * — re-running this script will UPDATE existing Retell resources to
 * match the local prompt files instead of creating duplicates.
 *
 * Idempotency key: `<name-prefix><payer-slug>`, e.g. `dentabill-delta-
 * dental-ppo`. The script lists existing agents, finds ours by name,
 * and reuses the same `llm_id` for in-place updates so per-call call
 * history stays attached to a stable agent identity in the dashboard.
 *
 *   pnpm --filter @dentabill/call-worker run provision:retell -- \
 *     --webhook-url https://<tunnel>/v1/webhooks/retell \
 *     --phone-number +13852627765
 *
 * Required env: RETELL_API_KEY (loaded from apps/call-worker/.env via
 * the symlink to /.env). Pass `--dry-run` to preview without writing.
 *
 * Exit codes: 0 success, 1 validation/usage error, 2 Retell API error.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { AGENTS_BY_PAYER, type AgentPrompt } from '@dentabill/payer-ivr';
import Retell from 'retell-sdk';
import { z } from 'zod';

// ─── env loading ─────────────────────────────────────────────────────────────

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));

/**
 * Try `apps/call-worker/.env` (the documented per-app symlink), then
 * fall back to repo-root `/.env` so the script works on a fresh clone
 * where the user hasn't run the symlink step yet. Order matters — the
 * per-app file wins if both exist.
 */
const ENV_PATHS = [resolve(SCRIPT_DIR, '../.env'), resolve(SCRIPT_DIR, '../../../.env')];

/**
 * Tiny .env parser — we don't want a runtime dotenv dep just for one
 * script. Handles `KEY=value` and `KEY="quoted value"`, ignores blank
 * lines and `#` comments, doesn't expand interpolation. The symlinked
 * file is the same `/.env` other apps load, so we get RETELL_* for free.
 */
function loadDotEnv(path: string): void {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return; // No file → rely on whatever's in process.env already.
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

for (const p of ENV_PATHS) loadDotEnv(p);

// ─── CLI parsing ─────────────────────────────────────────────────────────────

const VOICE_ID_DEFAULT = '11labs-Adrian';
const MODEL_DEFAULT = 'gpt-4.1';
const NAME_PREFIX_DEFAULT = 'dentabill-';

const ArgsSchema = z.object({
  webhookUrl: z
    .string()
    .url('webhook-url must be a valid URL')
    .refine((u) => u.startsWith('https://'), 'webhook-url must use https://'),
  phoneNumber: z
    .string()
    .regex(/^\+[0-9]{8,15}$/, 'phone-number must be E.164 (e.g. +13852627765)')
    .optional(),
  voiceId: z.string().min(1).default(VOICE_ID_DEFAULT),
  model: z.string().min(1).default(MODEL_DEFAULT),
  namePrefix: z.string().min(1).max(32).default(NAME_PREFIX_DEFAULT),
  dryRun: z.boolean().default(false),
});

type Args = z.infer<typeof ArgsSchema>;

function printUsageAndExit(message?: string): never {
  if (message) console.error(`error: ${message}\n`);
  console.error(
    [
      'Usage: provision-retell.mts --webhook-url <url> [options]',
      '',
      'Required:',
      '  --webhook-url <url>     HTTPS base for Retell webhooks (e.g. https://<tunnel>/v1/webhooks/retell)',
      '',
      'Optional:',
      `  --phone-number <e164>   Bind agent as outbound on this number (e.g. +13852627765)`,
      `  --voice-id <id>         Retell voice id (default ${VOICE_ID_DEFAULT})`,
      `  --model <id>            LLM model id (default ${MODEL_DEFAULT})`,
      `  --name-prefix <prefix>  Agent / LLM name prefix (default "${NAME_PREFIX_DEFAULT}")`,
      '  --dry-run               Print planned changes; do not write to Retell',
      '',
      'Env:',
      '  RETELL_API_KEY          Required. Loaded from apps/call-worker/.env or process.env.',
    ].join('\n'),
  );
  process.exit(1);
}

function parseArgs(argv: readonly string[]): Args {
  const raw: Record<string, string | boolean> = {};
  // pnpm `run <script> -- <args>` passes the literal `--` separator
  // through to the script. Also drop blank tokens so a broken shell
  // line-continuation (trailing whitespace after a `\`) doesn't surface
  // as an opaque "unexpected positional argument:  ".
  const filtered = argv.filter((t) => t !== '--' && t.trim().length > 0);
  for (let i = 0; i < filtered.length; i++) {
    const token = filtered[i];
    if (token === undefined) continue;
    if (!token.startsWith('--')) printUsageAndExit(`unexpected positional argument: ${token}`);
    const flag = token.slice(2);
    if (flag === 'dry-run') {
      raw.dryRun = true;
      continue;
    }
    if (flag === 'help' || flag === 'h') printUsageAndExit();
    const next = filtered[i + 1];
    if (next === undefined || next.startsWith('--')) {
      printUsageAndExit(`flag --${flag} expects a value`);
    }
    const camel = flag.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    raw[camel] = next;
    i += 1;
  }

  const parsed = ArgsSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((iss) => `  ${iss.path.join('.') || '<root>'}: ${iss.message}`)
      .join('\n');
    printUsageAndExit(`invalid arguments:\n${detail}`);
  }
  return parsed.data;
}

// ─── prompt assembly ─────────────────────────────────────────────────────────

/**
 * Build the `general_prompt` Retell stores on the LLM resource. Joins
 * persona and instructions with a blank line. The closing line is NOT
 * appended — instead we instruct the agent to deliver it via the
 * end_call tool's `execution_message_description`, so Retell speaks it
 * in the same beat as the hangup.
 */
function buildGeneralPrompt(prompt: AgentPrompt): string {
  return `${prompt.persona}\n\n${prompt.instructions}`;
}

function payerSlug(prompt: AgentPrompt): string {
  // "DELTA_DENTAL_PPO" → "delta-dental-ppo". Uniqueness is guaranteed
  // by the payer-code enum upstream.
  return prompt.payerCode.toLowerCase().replace(/_/g, '-');
}

function targetAgentName(prompt: AgentPrompt, prefix: string): string {
  return `${prefix}${payerSlug(prompt)}`;
}

// ─── Retell SDK helpers ──────────────────────────────────────────────────────

type RetellClient = InstanceType<typeof Retell>;

interface AgentLite {
  agent_id: string;
  agent_name?: string | null;
  response_engine: { type: string; llm_id?: string };
}

/**
 * Page through every agent and find the one matching `name`. Retell's
 * `list` returns up to 1000 by default which is well above any realistic
 * count of provisioned dental agents (we have 3); paging guard left as
 * a TODO if that ever stops being true.
 */
async function findAgentByName(client: RetellClient, name: string): Promise<AgentLite | undefined> {
  const list = await client.agent.list();
  for (const a of list) {
    if (a.agent_name === name && a.response_engine.type === 'retell-llm') {
      const re = a.response_engine as { type: 'retell-llm'; llm_id: string };
      return { agent_id: a.agent_id, agent_name: a.agent_name, response_engine: re };
    }
  }
  return undefined;
}

interface ProvisionedAgent {
  payerCode: string;
  agentName: string;
  agentId: string;
  llmId: string;
  action: 'created' | 'updated' | 'planned';
}

async function upsertAgentForPayer(
  client: RetellClient,
  prompt: AgentPrompt,
  args: Args,
): Promise<ProvisionedAgent> {
  const agentName = targetAgentName(prompt, args.namePrefix);
  const generalPrompt = buildGeneralPrompt(prompt);

  // Define the LLM payload + Agent payload up front so dry-run prints
  // exactly what the live path would send.
  const llmPayload = {
    general_prompt: generalPrompt,
    begin_message: prompt.beginMessage,
    start_speaker: 'agent' as const,
    model: args.model as never,
    general_tools: [
      {
        type: 'end_call' as const,
        name: 'end_call',
        description:
          'Terminate the phone call once the seven-item collection checklist is complete or the rep cannot help further.',
        speak_during_execution: true,
        execution_message_type: 'static_text' as const,
        execution_message_description: prompt.closingLine,
      },
    ],
  };

  const agentPayloadCommon = {
    voice_id: args.voiceId,
    agent_name: agentName,
    webhook_url: args.webhookUrl,
    webhook_events: ['call_started', 'call_ended', 'call_analyzed'] as Array<
      'call_started' | 'call_ended' | 'call_analyzed'
    >,
  };

  const existing = await findAgentByName(client, agentName);

  if (args.dryRun) {
    return {
      payerCode: prompt.payerCode,
      agentName,
      agentId: existing?.agent_id ?? '<would-create>',
      llmId: existing?.response_engine.llm_id ?? '<would-create>',
      action: 'planned',
    };
  }

  if (existing && existing.response_engine.llm_id) {
    // Update LLM, then agent. Both updates are idempotent — Retell
    // overwrites the prompt fields verbatim.
    await client.llm.update(existing.response_engine.llm_id, llmPayload);
    await client.agent.update(existing.agent_id, {
      ...agentPayloadCommon,
      response_engine: { type: 'retell-llm', llm_id: existing.response_engine.llm_id },
    });
    return {
      payerCode: prompt.payerCode,
      agentName,
      agentId: existing.agent_id,
      llmId: existing.response_engine.llm_id,
      action: 'updated',
    };
  }

  // Fresh create — LLM first, then agent referencing the new llm_id.
  // If the agent create fails after the LLM was made, a re-run picks
  // up the orphan LLM via name-based agent lookup → no orphan; instead
  // a *new* LLM gets created on rerun and the orphan stays dangling.
  // Acceptable: orphan LLMs are free, easy to clean up by hand, and a
  // best-effort rollback here would create more failure modes than it
  // prevents. Documented in the runbook addition.
  const llm = await client.llm.create(llmPayload);
  const agent = await client.agent.create({
    ...agentPayloadCommon,
    response_engine: { type: 'retell-llm', llm_id: llm.llm_id },
  });
  return {
    payerCode: prompt.payerCode,
    agentName,
    agentId: agent.agent_id,
    llmId: llm.llm_id,
    action: 'created',
  };
}

async function bindOutboundNumber(
  client: RetellClient,
  phoneNumber: string,
  primaryAgentId: string,
  dryRun: boolean,
): Promise<'updated' | 'planned'> {
  if (dryRun) return 'planned';
  // Retell's outbound-binding contract is a weighted list. We send a
  // single agent at weight 1 — our worker overrides per call via
  // `override_agent_id` (live.ts:90), so this binding only satisfies
  // Retell's "the number must point somewhere" requirement.
  await client.phoneNumber.update(phoneNumber, {
    outbound_agents: [{ agent_id: primaryAgentId, weight: 1 }],
  });
  return 'updated';
}

// ─── env-var name mapping ────────────────────────────────────────────────────

const PAYER_ENV_VAR: Readonly<Record<string, string>> = {
  DELTA_DENTAL_PPO: 'RETELL_AGENT_ID_DELTA_DENTAL_PPO',
  CIGNA_DENTAL: 'RETELL_AGENT_ID_CIGNA_DENTAL',
  METLIFE_DENTAL: 'RETELL_AGENT_ID_METLIFE_DENTAL',
};

// ─── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const apiKey = process.env.RETELL_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      'error: RETELL_API_KEY is empty. Set it in /.env at the repo root (or apps/call-worker/.env if the symlink is in place).',
    );
    process.exit(1);
  }

  const client = new Retell({ apiKey });
  const phaseThreePayers = Object.values(AGENTS_BY_PAYER).filter(
    (p): p is AgentPrompt => p !== undefined,
  );
  if (phaseThreePayers.length === 0) {
    console.error('error: AGENTS_BY_PAYER is empty — nothing to provision.');
    process.exit(1);
  }

  console.log(
    `Provisioning ${phaseThreePayers.length} Retell agent${phaseThreePayers.length === 1 ? '' : 's'}` +
      `${args.dryRun ? ' (dry run)' : ''}...`,
  );
  console.log(`  webhook_url: ${args.webhookUrl}`);
  console.log(`  voice_id:    ${args.voiceId}`);
  console.log(`  model:       ${args.model}`);
  console.log(`  name_prefix: ${args.namePrefix}`);
  console.log('');

  const results: ProvisionedAgent[] = [];
  for (const prompt of phaseThreePayers) {
    try {
      const result = await upsertAgentForPayer(client, prompt, args);
      results.push(result);
      console.log(
        `  [${result.action.padEnd(7)}] ${result.agentName.padEnd(36)} agent_id=${result.agentId} llm_id=${result.llmId}`,
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`  [failed ] ${prompt.payerCode}: ${detail}`);
      process.exit(2);
    }
  }

  // Pick the first provisioned agent as the outbound binding target.
  // The worker overrides per call so the choice doesn't matter
  // operationally — we use sort order purely for determinism.
  if (args.phoneNumber) {
    const primary = [...results].sort((a, b) => a.agentName.localeCompare(b.agentName))[0];
    if (!primary) {
      console.error('error: no agents provisioned, cannot bind phone number.');
      process.exit(2);
    }
    try {
      const action = await bindOutboundNumber(
        client,
        args.phoneNumber,
        primary.agentId,
        args.dryRun,
      );
      console.log('');
      console.log(
        `  [${action.padEnd(7)}] phone ${args.phoneNumber}  outbound → ${primary.agentName} (${primary.agentId})`,
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`error: failed to bind phone number ${args.phoneNumber}: ${detail}`);
      process.exit(2);
    }
  }

  // Final summary block — copy/paste straight into /.env.
  console.log('');
  console.log('─── Paste into /.env ────────────────────────────────────────');
  for (const r of results) {
    const envName = PAYER_ENV_VAR[r.payerCode];
    if (!envName) {
      console.warn(
        `  # warn: no env-var mapping for payerCode=${r.payerCode}; agent_id=${r.agentId}`,
      );
      continue;
    }
    console.log(`${envName}=${r.agentId}`);
  }
  if (args.phoneNumber) {
    console.log(`WORKER_OUTBOUND_NUMBER=${args.phoneNumber}`);
  }
  console.log('─────────────────────────────────────────────────────────────');

  if (args.dryRun) {
    console.log('\n(dry run — nothing was written to Retell)');
  }
}

main().catch((err) => {
  const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  console.error(`fatal: ${detail}`);
  process.exit(2);
});
