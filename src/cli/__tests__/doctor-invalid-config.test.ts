import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildManagedCodexHookTrustState,
  buildManagedCodexHooksConfig,
  planManagedCodexHooksRemoval,
} from '../../config/codex-hooks.js';
import { upsertManagedCodexHookTrustState } from '../../config/generator.js';

function runOmx(
  cwd: string,
  argv: string[],
  envOverrides: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string; error?: string } {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(testDir, '..', '..', '..');
  const omxBin = join(repoRoot, 'dist', 'cli', 'omx.js');
  const r = spawnSync(process.execPath, [omxBin, ...argv], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, ...envOverrides },
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error?.message };
}

function shouldSkipForSpawnPermissions(err?: string): boolean {
  return typeof err === 'string' && /(EPERM|EACCES)/i.test(err);
}

describe('omx doctor invalid config detection', () => {
  it('fails when config.toml contains duplicate [tui] tables', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'omx-doctor-invalid-config-'));
    try {
      const home = join(wd, 'home');
      const codexDir = join(home, '.codex');
      await mkdir(codexDir, { recursive: true });

      await writeFile(
        join(codexDir, 'config.toml'),
        `
model = "gpt-5.6-sol"

[features]
multi_agent = false

[agents]
max_threads = 17
max_depth = 5

[tui]
status_line = ["model-with-reasoning"]

[tui]
theme = "base16-ocean-light"
`.trimStart(),
      );

      const res = runOmx(wd, ['doctor'], {
        HOME: home,
        CODEX_HOME: codexDir,
      });

      if (shouldSkipForSpawnPermissions(res.error)) return;

      assert.equal(res.status, 0, res.stderr || res.stdout);
      assert.match(
        res.stdout,
        /\[XX\] Config: invalid config\.toml \(possible duplicate TOML table such as \[tui\]\)/,
      );
      assert.doesNotMatch(res.stdout, /GPT-5\.6 multi-agent compatibility/);
      assert.doesNotMatch(res.stdout, /All checks passed!/);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('fails strict load validation when hooks.json contains top-level state', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'omx-doctor-hooks-json-state-'));
    try {
      const home = join(wd, 'home');
      const codexDir = join(home, '.codex');
      await mkdir(codexDir, { recursive: true });
      await writeFile(
        join(codexDir, 'config.toml'),
        'omx_enabled = true\nhooks = true\n',
      );
      await writeFile(
        join(codexDir, 'hooks.json'),
        JSON.stringify({
          state: {
            '/tmp/hooks.json:stop:0:0': { trusted_hash: 'sha256:legacy' },
          },
          hooks: {
            SessionStart: [{ hooks: [{ type: 'command', command: 'node /repo/dist/scripts/codex-native-hook.js' }] }],
            PreToolUse: [{ hooks: [{ type: 'command', command: 'node /repo/dist/scripts/codex-native-hook.js' }] }],
            PostToolUse: [{ hooks: [{ type: 'command', command: 'node /repo/dist/scripts/codex-native-hook.js' }] }],
            UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node /repo/dist/scripts/codex-native-hook.js' }] }],
            PreCompact: [{ hooks: [{ type: 'command', command: 'node /repo/dist/scripts/codex-native-hook.js' }] }],
            PostCompact: [{ hooks: [{ type: 'command', command: 'node /repo/dist/scripts/codex-native-hook.js' }] }],
            Stop: [{ hooks: [{ type: 'command', command: 'node /repo/dist/scripts/codex-native-hook.js' }] }],
          },
        }),
      );

      const res = runOmx(wd, ['doctor'], {
        HOME: home,
        CODEX_HOME: codexDir,
      });

      if (shouldSkipForSpawnPermissions(res.error)) return;

      assert.equal(res.status, 0, res.stderr || res.stdout);
      assert.match(
        res.stdout,
        /\[XX\] Native hooks: hooks\.json failed strict load validation \(invalid_document\): Codex does not accept unknown root field state; inspect the file manually because doctor will not modify it/,
      );
      assert.doesNotMatch(res.stdout, /Run "omx setup" to fix installation issues/);
      assert.doesNotMatch(res.stdout, /Native hooks:.*--force/);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('doctor preserves approved foreign trust behind repeated managed banners (#3818)', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'omx-doctor-hook-trust-markers-'));
    try {
      const home = join(wd, 'home');
      const codexDir = join(home, '.codex');
      const hooksPath = join(codexDir, 'hooks.json');
      const configPath = join(codexDir, 'config.toml');
      await mkdir(codexDir, { recursive: true });

      const hooks = buildManagedCodexHooksConfig(wd, { codexHomeDir: codexDir });
      hooks.hooks.PreToolUse[0]!.hooks.push({
        type: 'command',
        command: 'echo foreign',
        timeout: 600,
      });
      const hooksContent = JSON.stringify(hooks, null, 2);
      const removalPlan = planManagedCodexHooksRemoval(hooksContent, hooksPath, {
        codexHomeDir: codexDir,
      });
      assert.equal(removalPlan.ok, true);
      if (!removalPlan.ok) return;

      const foreignKey = `${hooksPath}:pre_tool_use:0:1`;
      const foreignHash = removalPlan.coordinateMoves.find(
        (move) => move.oldKey === foreignKey,
      )?.expectedTrustedHash;
      assert.ok(foreignHash, "fixture must include Codex's expected foreign-hook hash");
      const managedTrustState = buildManagedCodexHookTrustState(hooksPath, wd, {
        codexHomeDir: codexDir,
        hooksContent,
      });
      const startMarker = '# OMX-owned Codex hook trust state';
      const endMarker = '# End OMX-owned Codex hook trust state';
      const initialConfig = upsertManagedCodexHookTrustState(
        'model = "gpt-5.6-sol"\n',
        wd,
        hooksPath,
        { codexHomeDir: codexDir, managedTrustState },
      );
      const repeatedBanners = initialConfig.replace(
        startMarker,
        Array.from({ length: 8 }, () => startMarker).join('\n'),
      );
      const configWithForeignTrust = repeatedBanners.replace(
        endMarker,
        [
          `[hooks.state.${JSON.stringify(foreignKey)}]`,
          `trusted_hash = ${JSON.stringify(foreignHash)}`,
          '',
          endMarker,
        ].join('\n'),
      );
      await writeFile(hooksPath, hooksContent);
      await writeFile(configPath, configWithForeignTrust);

      const res = runOmx(wd, ['doctor'], {
        HOME: home,
        CODEX_HOME: codexDir,
      });
      if (shouldSkipForSpawnPermissions(res.error)) return;

      assert.equal(res.status, 0, res.stderr || res.stdout);
      assert.match(
        res.stdout,
        /\[OK\] Native hooks: hooks\.json includes OMX-managed coverage for all native hook events/,
      );
      assert.doesNotMatch(res.stdout, /managed_trust_key_conflict/);
      assert.equal(await readFile(configPath, 'utf-8'), configWithForeignTrust);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('fails closed when hooks.json contains invalid UTF-8 bytes', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'omx-doctor-hooks-json-invalid-utf8-'));
    try {
      const home = join(wd, 'home');
      const codexDir = join(home, '.codex');
      await mkdir(codexDir, { recursive: true });
      await writeFile(join(codexDir, 'config.toml'), 'omx_enabled = true\nhooks = true\n');
      await writeFile(join(codexDir, 'hooks.json'), Buffer.from([0x7b, 0xff, 0x7d]));

      const res = runOmx(wd, ['doctor'], { HOME: home, CODEX_HOME: codexDir });
      if (shouldSkipForSpawnPermissions(res.error)) return;

      assert.equal(res.status, 0, res.stderr || res.stdout);
      assert.match(
        res.stdout,
        /\[XX\] Native hooks: hooks\.json at .* is not valid UTF-8; inspect the file manually because doctor will not modify it/,
      );
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });

  it('preserves a UTF-8 BOM so strict hooks validation rejects it', async () => {
    const wd = await mkdtemp(join(tmpdir(), 'omx-doctor-hooks-json-bom-'));
    try {
      const home = join(wd, 'home');
      const codexDir = join(home, '.codex');
      const hooksPath = join(codexDir, 'hooks.json');
      const hooks = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('{"hooks":{}}\n', 'utf-8'),
      ]);
      await mkdir(codexDir, { recursive: true });
      await writeFile(join(codexDir, 'config.toml'), 'omx_enabled = true\nhooks = true\n');
      await writeFile(hooksPath, hooks);

      const res = runOmx(wd, ['doctor'], { HOME: home, CODEX_HOME: codexDir });
      if (shouldSkipForSpawnPermissions(res.error)) return;

      assert.equal(res.status, 0, res.stderr || res.stdout);
      assert.match(res.stdout, /hooks\.json failed strict load validation \(invalid_document\)/);
      assert.deepEqual(await readFile(hooksPath), hooks);
    } finally {
      await rm(wd, { recursive: true, force: true });
    }
  });
});