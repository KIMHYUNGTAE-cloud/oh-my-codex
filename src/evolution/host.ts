/** Read the host's supported catalog without touching shared auth, config or caches. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import TOML from '@iarna/toml';
import { z } from 'zod';
import { effortSchema } from './roles.js';

export const modelSchema = z.object({ id: z.string().min(1).max(150),
  efforts: z.array(effortSchema).min(1), defaultEffort: effortSchema,
  description: z.string().max(4000).default('') }).strict();
export const hostSchema = z.object({ schemaVersion: z.literal(1), source: z.literal('codex-model-list'),
  observedAt: z.string().datetime(), models: z.array(modelSchema).min(1).max(200) }).strict()
  .refine(v => new Set(v.models.map(m => m.id)).size === v.models.length && v.models.every(m => m.efforts.includes(m.defaultEffort)), 'Invalid host catalog');
export type HostCatalog = z.infer<typeof hostSchema>;
export const parentSchema = z.object({ model: z.string().min(1).max(150), effort: effortSchema }).strict();
export type ParentModel = z.infer<typeof parentSchema>;

export function configuredParent(root: string, codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex')): ParentModel {
  let config: Record<string, unknown> = {};
  for (const path of [join(codexHome, 'config.toml'), join(root, '.codex/config.toml')]) {
    if (existsSync(path)) config = { ...config, ...TOML.parse(readFileSync(path, 'utf8')) };
  }
  if (config.profile) {
    const profiles = config.profiles as Record<string, Record<string, unknown>> | undefined;
    const profile = profiles?.[String(config.profile)];
    if (!profile) throw new Error('Unknown configured profile; supply explicit parent model and effort');
    config = { ...config, ...profile };
  }
  if (config.model_provider && config.model_provider !== 'openai') throw new Error('Custom provider requires a provider-specific catalog adapter');
  return parentSchema.parse({ model: config.model, effort: config.model_reasoning_effort });
}

export async function discoverHost(options: { codexBin?: string; codexHome?: string; timeoutMs?: number } = {}): Promise<HostCatalog> {
  const source = join(options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json');
  const original = existsSync(source) ? readFileSync(source) : null;
  const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const home = mkdtempSync(join(tmpdir(), 'omx-adaptive-host-')), codexHome = join(home, '.codex');
  mkdirSync(codexHome, { mode: 0o700 });
  try {
    if (original) {
      const auth = JSON.parse(original.toString('utf8')) as { tokens?: Record<string, unknown> };
      if (auth.tokens) auth.tokens.refresh_token = '';
      writeFileSync(join(codexHome, 'auth.json'), JSON.stringify(auth), { mode: 0o600 });
    }
    writeFileSync(join(codexHome, 'config.toml'), 'cli_auth_credentials_store = "file"\n');
    const child = spawn(options.codexBin ?? 'codex', ['app-server', '--stdio'], {
      cwd: home, env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: codexHome, LANG: 'C.UTF-8' },
      stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    });
    // No thread/start or turn/start requests: discovery consumes no model inference.
    return await new Promise<HostCatalog>((resolve, reject) => {
      let buffer = '', bytes = 0, done = false, nextId = 2;
      const decoder = new StringDecoder('utf8');
      const models: z.infer<typeof modelSchema>[] = [];
      const cursors = new Set<string>();
      const finish = (error?: Error, value?: HostCatalog) => {
        if (done) return; done = true; clearTimeout(timer);
        child.stdin.end();
        try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* exited */ }
        if (error) reject(error); else resolve(value!);
      };
      const timer = setTimeout(() => finish(new Error('Host model discovery timed out')), options.timeoutMs ?? 30000);
      const send = (value: unknown) => child.stdin.write(JSON.stringify(value) + '\n');
      child.stdin.on('error', () => finish(new Error('Host discovery transport closed')));
      child.on('error', () => finish(new Error('Could not start Codex host discovery')));
      child.on('exit', () => { if (!done) finish(new Error('Codex exited during host discovery')); });
      child.stderr.on('data', () => { /* Diagnostics may contain account data; never persist them. */ });
      child.stdout.on('data', (chunk: Buffer) => {
        if (done) return;
        bytes += chunk.length; if (bytes > 2_000_000) { finish(new Error('Host catalog exceeds size limit')); return; }
        buffer += decoder.write(chunk);
        let newline: number;
        while (!done && (newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          try {
            const message = JSON.parse(line) as { id?: number; error?: unknown; result?: { data?: Array<Record<string, unknown>>; nextCursor?: string | null } };
            if (message.id === undefined) continue;
            if (message.error) throw new Error('Host rejected model discovery');
            if (message.id === 1) {
              send({ method: 'initialized', params: {} }); send({ id: nextId, method: 'model/list', params: { limit: 100, includeHidden: false } });
            } else if (message.id === nextId) {
              if (!Array.isArray(message.result?.data)) throw new Error('Invalid model/list response');
              for (const model of message.result.data) models.push(modelSchema.parse({ id: model.model ?? model.id,
                defaultEffort: model.defaultReasoningEffort,
                efforts: (model.supportedReasoningEfforts as Array<{ reasoningEffort: string }>).map(e => e.reasoningEffort),
                description: model.description ?? model.displayName ?? '' }));
              const cursor = message.result.nextCursor;
              if (cursor) {
                if (cursors.has(cursor) || models.length > 200) throw new Error('Invalid catalog pagination');
                cursors.add(cursor); nextId++; send({ id: nextId, method: 'model/list', params: { limit: 100, includeHidden: false, cursor } });
              } else finish(undefined, hostSchema.parse({ schemaVersion: 1, source: 'codex-model-list', observedAt: new Date().toISOString(), models }));
            } else throw new Error('Unexpected host response');
          } catch { finish(new Error('Host model discovery returned an invalid or unsupported catalog')); }
        }
      });
      send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'omx-adaptive', version: '0.1.0' }, capabilities: { experimentalApi: true } } });
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
    if (original && (!existsSync(source) || sha(readFileSync(source)) !== sha(original))) throw new Error('Original authentication changed during discovery');
  }
}
