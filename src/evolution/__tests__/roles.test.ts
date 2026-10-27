import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import TOML from '@iarna/toml';
import { apply, digest, evaluate, initEvolution, propose, recordIncident, recover, rollback, status } from '../service.js';
import { compileRoles, type ProjectRole } from '../roles.js';

export const role: ProjectRole = { id: 'schema-auditor', purpose: 'Review schema compatibility', activation: ['Schema changes'],
  capabilities: ['schema-review'], inputs: ['Schema and consumers'], outputs: ['Compatibility findings with paths'],
  instructions: 'Inspect only relevant schema and consumers. Report concrete incompatibilities. Literal \\n and """ remain literal.',
  verification: ['Check consumer cases'], modelTier: 'balanced', scope: 'read-only' };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'adaptive-roles-')); initEvolution(root);
  writeFileSync(join(root, 'evidence.txt'), 'Observed schema incompatibility; a scoped schema audit is reusable.');
  writeFileSync(join(root, 'check.mjs'), `import fs from 'node:fs';
if(process.argv[2]==='reproduce') process.exit(fs.existsSync('.codex/agents/adaptive-schema-auditor.toml')&&fs.existsSync('.codex/prompts/adaptive-schema-auditor.md')?0:1);
if(process.argv[2]==='regression') process.exit(fs.readFileSync('stable.txt','utf8')==='unchanged'?0:1);`);
  writeFileSync(join(root, 'stable.txt'), 'unchanged');
  const policyPath = join(root, '.omx-project/policy.json'), policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  policy.checks = ['reproduce', 'regression'].map(kind => ({ id: kind, kind, categories: ['roles'], command: process.execPath, args: ['check.mjs', kind], timeoutMs: 3000 }));
  writeFileSync(policyPath, JSON.stringify(policy));
  recordIncident(root, { id: 'schema-finding', sessionId: 's', taskId: 't', type: 'user-correction', summary: 'Schema audit needed',
    evidence: [{ path: 'evidence.txt', sha256: digest(readFileSync(join(root, 'evidence.txt'))) }] });
  const input = { id: 'schema-role', incidentIds: ['schema-finding'], reason: 'Narrow reusable role', roles: { schemaVersion: 1, roles: [role] } };
  return { root, input, prepare() { propose(root, input); return evaluate(root, input.id); }, cleanup() { rmSync(root, { recursive: true, force: true }); } };
}
test('role compiler round-trips instructions without TOML escapes and never pins current models', () => {
  const files = compileRoles({ schemaVersion: 1, roles: [role] });
  const parsed = TOML.parse(files.get('.codex/agents/adaptive-schema-auditor.toml')!);
  assert.ok(String(parsed.developer_instructions).includes(role.instructions));
  assert.equal(parsed.model, undefined); assert.equal(parsed.model_reasoning_effort, undefined);
  assert.equal(files.size, 3);
});
test('role source and both generated artifacts apply together and rollback removes newly created files', () => {
  const f = fixture(); try {
    assert.equal(f.prepare().state, 'ready');
    assert.throws(() => apply(f.root, f.input.id, true), /category disabled/);
    apply(f.root, f.input.id); assert.equal(status(f.root).roles, 1);
    assert.equal(TOML.parse(readFileSync(join(f.root, '.codex/agents/adaptive-schema-auditor.toml'), 'utf8')).name, 'adaptive-schema-auditor');
    rollback(f.root, f.input.id); assert.equal(status(f.root).roles, 0);
    assert.equal(existsSync(join(f.root, '.omx-project/roles.json')), false);
    assert.equal(existsSync(join(f.root, '.codex/prompts/adaptive-schema-auditor.md')), false);
  } finally { f.cleanup(); }
});
test('user edits to generated files block rollback and subsequent role changes', () => {
  const f = fixture(); try {
    f.prepare(); apply(f.root, f.input.id);
    const path = join(f.root, '.codex/prompts/adaptive-schema-auditor.md'); writeFileSync(path, 'User owns this edit');
    assert.throws(() => rollback(f.root, f.input.id), /Rollback conflict/);
    assert.throws(() => propose(f.root, { ...f.input, id: 'retire-role', roles: { schemaVersion: 1, roles: [] } }), /Generated role conflict/);
    assert.equal(readFileSync(path, 'utf8'), 'User owns this edit');
  } finally { f.cleanup(); }
});
test('retirement is evaluated against removal behavior and restores all prior files on rollback', () => {
  const f = fixture(); try {
    f.prepare(); apply(f.root, f.input.id);
    writeFileSync(join(f.root, 'check.mjs'), `import fs from 'node:fs';process.exit(process.argv[2]==='regression'?0:fs.existsSync('.codex/agents/adaptive-schema-auditor.toml')?1:0);`);
    propose(f.root, { ...f.input, id: 'retire', roles: { schemaVersion: 1, roles: [] } });
    assert.equal(evaluate(f.root, 'retire').state, 'ready'); apply(f.root, 'retire');
    assert.equal(status(f.root).roles, 0); rollback(f.root, 'retire'); assert.equal(status(f.root).roles, 1);
  } finally { f.cleanup(); }
});
test('guidance-only checks cannot qualify a role proposal', () => {
  const f = fixture(); try {
    const path = join(f.root, '.omx-project/policy.json'), p = JSON.parse(readFileSync(path, 'utf8'));
    p.checks.forEach((c: { categories: string[] }) => { c.categories = ['guidance']; }); writeFileSync(path, JSON.stringify(p));
    assert.throws(() => f.prepare(), /reproduce and regression/);
  } finally { f.cleanup(); }
});
test('SIGKILL between role asset replacements recovers a multi-file journal idempotently', () => {
  const f = fixture(); try {
    f.prepare();
    const script = `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const rename=fs.renameSync;fs.renameSync=(a,b)=>{rename(a,b);if(String(b).endsWith('adaptive-schema-auditor.toml'))process.kill(process.pid,'SIGKILL');};syncBuiltinESMExports();
const {apply}=await import(${JSON.stringify(new URL('../service.js', import.meta.url).href)});apply(${JSON.stringify(f.root)},'schema-role');`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { PATH: process.env.PATH, HOME: f.root, CODEX_HOME: join(f.root, 'home') } });
    assert.equal(child.signal, 'SIGKILL'); assert.equal(status(f.root).pendingRecovery, true);
    assert.equal(recover(f.root).state, 'recovered'); assert.equal(status(f.root).roles, 1);
    assert.equal(recover(f.root).state, 'no-pending-transaction'); rollback(f.root, f.input.id);
    assert.equal(status(f.root).roles, 0);
  } finally { f.cleanup(); }
});
test('duplicate roles and arbitrary executable or permission fields are rejected', () => {
  assert.throws(() => compileRoles({ schemaVersion: 1, roles: [role, role] }), /Duplicate/);
  assert.throws(() => compileRoles({ schemaVersion: 1, roles: [{ ...role, sandbox: 'danger-full-access' }] }), /Unrecognized/);
});
test('persistent roles cannot bind an unapplied project skill', () => {
  const f = fixture();
  try {
    assert.throws(() => propose(f.root, { ...f.input, roles: { schemaVersion: 1, roles: [{ ...role, skills: ['missing-skill'] }] } }), /missing project skill/);
  } finally { f.cleanup(); }
});
