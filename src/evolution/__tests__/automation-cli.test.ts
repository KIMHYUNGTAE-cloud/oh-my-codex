import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('bin/omx-adaptive.mjs');

test('evolve CLI configures agent-managed mode and a host-validated project model pool', () => {
  const root = mkdtempSync(join(tmpdir(), 'omx-auto-cli-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const fakeCodex = join(bin, 'codex');
  writeFileSync(fakeCodex, `#!${process.execPath}\nconst readline=require('node:readline');
readline.createInterface({input:process.stdin}).on('line',line=>{
  const q=JSON.parse(line);
  if(q.id===1)console.log(JSON.stringify({id:1,result:{}}));
  if(q.method==='model/list')console.log(JSON.stringify({id:q.id,result:{data:[{model:'fixture-worker',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}]}],nextCursor:null}}));
});\n`);
  chmodSync(fakeCodex, 0o700);
  const env = { ...process.env, HOME: root, CODEX_HOME: join(root, '.codex'), PATH: `${bin}:${process.env.PATH ?? ''}` };
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, 'evolve', ...args],
    { cwd: root, env, encoding: 'utf8', timeout: 10_000 });
  try {
    const on = run('auto', 'on');
    assert.equal(on.status, 0, on.stderr);
    assert.equal(JSON.parse(on.stdout).enabled, true);
    assert.equal(JSON.parse(run('auto', 'status').stdout).enabled, true);
    const policy = JSON.parse(readFileSync(join(root, '.omx-project', 'policy.json'), 'utf8'));
    assert.deepEqual(policy.autoApply, ['knowledge', 'instruction', 'procedure', 'roles', 'skills']);
    const candidates = join(root, 'candidates.json');
    writeFileSync(candidates, JSON.stringify({ candidates: [{ model: 'fixture-worker', tier: 'economy', efforts: ['low'] }] }));
    const set = run('models', 'candidates', 'set', '--file', candidates);
    assert.equal(set.status, 0, set.stderr);
    assert.equal(JSON.parse(set.stdout).candidates[0].model, 'fixture-worker');
    assert.equal(JSON.parse(run('models', 'candidates', 'list').stdout).candidates.length, 1);
    writeFileSync(candidates, JSON.stringify({ candidates: [{ model: 'missing', tier: 'economy', efforts: ['low'] }] }));
    const denied = run('models', 'candidates', 'set', '--file', candidates);
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /absent from host catalog/);
    assert.equal(JSON.parse(run('models', 'candidates', 'clear').stdout).candidates.length, 0);
    const add = run('models', 'candidates', 'add', 'fixture-worker', '--tier', 'balanced', '--efforts', 'low,high');
    assert.equal(add.status, 0, add.stderr);
    assert.deepEqual(JSON.parse(add.stdout).candidates[0].efforts, ['low', 'high']);
    assert.equal(JSON.parse(run('models', 'candidates', 'remove', 'fixture-worker').stdout).candidates.length, 0);
    const off = run('auto', 'off');
    assert.equal(off.status, 0, off.stderr);
    assert.equal(JSON.parse(off.stdout).enabled, false);
    assert.deepEqual(JSON.parse(readFileSync(join(root, '.omx-project', 'policy.json'), 'utf8')).autoApply, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
