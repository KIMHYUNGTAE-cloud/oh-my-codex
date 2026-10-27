import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configuredParent, discoverHost } from '../host.js';

test('host discovery paginates without model calls, isolates config/auth, and removes temporary credentials', async () => {
  const root = mkdtempSync(join(tmpdir(), 'adaptive-host-test-'));
  try {
    const original = JSON.stringify({ tokens: { refresh_token: 'fixture-refresh', access_token: 'fixture-access' } });
    writeFileSync(join(root, 'auth.json'), original);
    const log = join(root, 'probe.json'), bin = join(root, 'codex-fixture');
    writeFileSync(bin, `#!${process.execPath}
const fs=require('fs'),readline=require('readline');
const report={home:process.env.HOME,methods:[],refreshRemoved:JSON.parse(fs.readFileSync(process.env.CODEX_HOME+'/auth.json')).tokens.refresh_token===''};
readline.createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);report.methods.push(q.method);fs.writeFileSync(${JSON.stringify(log)},JSON.stringify(report));
if(q.id===1)console.log(JSON.stringify({id:1,result:{}}));
if(q.method==='model/list')console.log(JSON.stringify({id:q.id,result:{data:[{model:q.params.cursor?'model-b':'model-a',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}]}],nextCursor:q.params.cursor?null:'page-2'}}));});
`); chmodSync(bin, 0o700);
    const host = await discoverHost({ codexBin: bin, codexHome: root }); assert.deepEqual(host.models.map(m => m.id), ['model-a', 'model-b']);
    const report = JSON.parse(readFileSync(log, 'utf8'));
    assert.deepEqual(report.methods, ['initialize', 'initialized', 'model/list', 'model/list']);
    assert.equal(report.refreshRemoved, true); assert.equal(existsSync(report.home), false);
    assert.equal(readFileSync(join(root, 'auth.json'), 'utf8'), original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('discovery timeout and malformed responses fail without replacing the catalog', async () => {
  const root = mkdtempSync(join(tmpdir(), 'adaptive-host-test-'));
  try {
    const bin = join(root, 'codex-fixture'); writeFileSync(bin, `#!${process.execPath}\nsetInterval(()=>{},1000);`); chmodSync(bin, 0o700);
    await assert.rejects(discoverHost({ codexBin: bin, codexHome: root, timeoutMs: 100 }), /timed out/);
    writeFileSync(bin, `#!${process.execPath}\nconsole.log('not JSON');setInterval(()=>{},1000);`);
    await assert.rejects(discoverHost({ codexBin: bin, codexHome: root, timeoutMs: 1000 }), /invalid/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('configured defaults read project/profile overrides without modifying user config', () => {
  const root = mkdtempSync(join(tmpdir(), 'adaptive-host-test-')), home = join(root, 'home'); mkdirSync(home);
  try {
    const original = 'model="first"\nmodel_reasoning_effort="medium"\n'; writeFileSync(join(home, 'config.toml'), original);
    mkdirSync(join(root, '.codex')); writeFileSync(join(root, '.codex/config.toml'), 'profile="work"\n[profiles.work]\nmodel="second"\nmodel_reasoning_effort="high"\n');
    assert.deepEqual(configuredParent(root, home), { model: 'second', effort: 'high' });
    assert.equal(readFileSync(join(home, 'config.toml'), 'utf8'), original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
