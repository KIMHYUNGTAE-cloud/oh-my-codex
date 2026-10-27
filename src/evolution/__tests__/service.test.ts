import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { automationStatus, setAutomation, initEvolution, digest, recordIncident, propose, evaluate, apply, rollback, recover, status, evolutionContext, safeEvolutionContext, settleEvolution, evolutionWorkflow } from '../service.js';

const cli = resolve('bin/omx-adaptive.mjs');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'omx-evolution-'));
  initEvolution(root);
  writeFileSync(join(root, 'evidence.md'), 'User corrected test invocation: use node checks.mjs.');
  writeFileSync(join(root, 'checks.mjs'), `import fs from 'node:fs';
const entries=JSON.parse(fs.readFileSync('.omx-project/guidance.json','utf8')).entries;
if(process.argv[2]==='reproduce')process.exit(entries.some(e=>e.id==='test-command')?0:1);
if(process.argv[2]==='regression')process.exit(fs.readFileSync('stable.txt','utf8')==='stable'?0:1);
`);
  writeFileSync(join(root, 'stable.txt'), 'stable');
  const policyPath = join(root, '.omx-project/policy.json');
  const p = JSON.parse(readFileSync(policyPath, 'utf8'));
  p.checks = ['reproduce', 'regression'].map(kind => ({ id: kind, kind, command: process.execPath, args: ['checks.mjs', kind], timeoutMs: 3000 }));
  writeFileSync(policyPath, JSON.stringify(p));
  const incident = { id: 'correct-test', sessionId: 'session-one', taskId: 'task-one', type: 'user-correction', summary: 'Use project test entry point', evidence: [{ path: 'evidence.md', sha256: digest(readFileSync(join(root, 'evidence.md'))) }] };
  const proposal = { id: 'fix-test', incidentIds: [incident.id], reason: 'Apply the observed project correction',
    entry: { id: 'test-command', kind: 'procedure', title: 'Test invocation', content: 'For project tests, execute node checks.mjs.', when: ['test', '테스트'] } };
  return { root, incident, proposal, cleanup() { rmSync(root, { recursive: true, force: true }); } };
}
function prepared(f: ReturnType<typeof fixture>) { recordIncident(f.root, f.incident); propose(f.root, f.proposal); return evaluate(f.root, f.proposal.id); }
test('uninitialized projects are read-only no-ops', () => {
  const root = mkdtempSync(join(tmpdir(), 'omx-evolution-empty-'));
  try { assert.equal(evolutionContext(root), ''); assert.equal(existsSync(join(root, '.omx')), false); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
test('correction -> evaluation -> automatic application -> scoped context -> rollback', () => {
  const f = fixture(); try {
    assert.equal(prepared(f).state, 'ready');
    assert.equal(apply(f.root, f.proposal.id, true).effect, 'pending-observation');
    assert.match(evolutionContext(f.root, 'run project tests'), /node checks.mjs/);
    assert.equal(evolutionContext(f.root, 'format a document'), '');
    assert.equal(rollback(f.root, f.proposal.id).state, 'rolledBack');
    assert.equal(evolutionContext(f.root, 'test'), '');
  } finally { f.cleanup(); }
});
test('agent-managed mode enables all evaluated categories without erasing checks and can be disabled', () => {
  const f = fixture(); try {
    assert.equal(automationStatus(f.root).enabled, false);
    const enabled = setAutomation(f.root, true);
    assert.equal(enabled.enabled, true);
    assert.deepEqual(enabled.autoApply, ['knowledge', 'instruction', 'procedure', 'roles', 'skills']);
    assert.equal(enabled.checksConfigured, true);
    assert.match(evolutionWorkflow(f.root), /agent-managed evolution enabled/i);
    assert.equal(prepared(f).state, 'ready');
    assert.equal(settleEvolution(f.root, true).state, 'applied');
    const disabled = setAutomation(f.root, false);
    assert.deepEqual(disabled.autoApply, []);
    assert.doesNotMatch(evolutionWorkflow(f.root), /agent-managed evolution enabled/i);
    assert.equal(disabled.checksConfigured, true);
  } finally { f.cleanup(); }
});
test('duplicate findings do not inflate recurrence and conflicting IDs fail', () => {
  const f = fixture(); try {
    recordIncident(f.root, f.incident);
    assert.equal(recordIncident(f.root, { ...f.incident, id: 'same-observation' }).duplicate, true);
    assert.equal(status(f.root).incidents, 1);
    assert.throws(() => recordIncident(f.root, { ...f.incident, summary: 'different' }), /conflict/);
  } finally { f.cleanup(); }
});
test('fabricated evidence digest is rejected', () => {
  const f = fixture(); try { assert.throws(() => recordIncident(f.root, { ...f.incident, evidence: [{ path: 'evidence.md', sha256: '0'.repeat(64) }] }), /digest/); } finally { f.cleanup(); }
});
test('stale incident evidence prevents proposal', () => {
  const f = fixture(); try { recordIncident(f.root, f.incident); writeFileSync(join(f.root, 'evidence.md'), 'edited'); assert.throws(() => propose(f.root, f.proposal), /Evidence changed/); } finally { f.cleanup(); }
});
test('missing reproduction or regression checks cannot make a proposal ready', () => {
  const f = fixture(); try {
    recordIncident(f.root, f.incident); propose(f.root, f.proposal);
    const p = join(f.root, '.omx-project/policy.json'), data = JSON.parse(readFileSync(p, 'utf8')); data.checks = data.checks.slice(0, 1); writeFileSync(p, JSON.stringify(data));
    assert.throws(() => evaluate(f.root, f.proposal.id), /reproduce and regression/);
    assert.throws(() => apply(f.root, f.proposal.id), /Passing evaluation/);
  } finally { f.cleanup(); }
});
test('candidate regression failure prevents application', () => {
  const f = fixture(); try {
    writeFileSync(join(f.root, 'stable.txt'), 'regression'); assert.equal(prepared(f).state, 'proposed');
    assert.throws(() => apply(f.root, f.proposal.id), /Passing evaluation/);
  } finally { f.cleanup(); }
});
test('missing evaluator executable is unknown failure, not successful reproduction', () => {
  const f = fixture(); try {
    const p = join(f.root, '.omx-project/policy.json'), data = JSON.parse(readFileSync(p, 'utf8')); data.checks[0].command = '/missing/evaluator'; writeFileSync(p, JSON.stringify(data));
    const result = prepared(f); assert.equal(result.state, 'proposed'); assert.equal(result.evaluation.checks[0]!.baseline, null);
  } finally { f.cleanup(); }
});
for (const change of ['source', 'policy', 'guidance', 'candidate']) test(`${change} drift invalidates evaluated proposal`, () => {
  const f = fixture(); try {
    prepared(f);
    if (change === 'source') writeFileSync(join(f.root, 'stable.txt'), 'later edit');
    if (change === 'policy') { const p = join(f.root, '.omx-project/policy.json'); writeFileSync(p, `${readFileSync(p, 'utf8')} `); }
    if (change === 'guidance') { const p = join(f.root, '.omx-project/guidance.json'); writeFileSync(p, `${readFileSync(p, 'utf8')} `); }
    if (change === 'candidate') { const p = join(f.root, '.omx/evolution/ledger.json'), data = JSON.parse(readFileSync(p, 'utf8')); data.proposals[0].candidate += ' '; writeFileSync(p, JSON.stringify(data)); }
    assert.throws(() => apply(f.root, f.proposal.id, true), /Stale evaluation/);
  } finally { f.cleanup(); }
});
test('category opt-out is respected and later policy edits also require reevaluation', () => {
  const f = fixture(); try {
    const p = join(f.root, '.omx-project/policy.json'), data = JSON.parse(readFileSync(p, 'utf8')); data.autoApply = []; writeFileSync(p, JSON.stringify(data));
    prepared(f); assert.throws(() => apply(f.root, f.proposal.id, true), /category disabled/);
  } finally { f.cleanup(); }
});
test('agent-inferred findings require independent recurrence for automatic apply', () => {
  const f = fixture(); try { f.incident.type = 'verified-finding'; prepared(f); assert.throws(() => apply(f.root, f.proposal.id, true), /independent evidence/); } finally { f.cleanup(); }
});
test('subsequent user edit is preserved by rollback conflict', () => {
  const f = fixture(); try {
    prepared(f); apply(f.root, f.proposal.id); const p = join(f.root, '.omx-project/guidance.json'), edited = `${readFileSync(p, 'utf8')} `; writeFileSync(p, edited);
    assert.throws(() => rollback(f.root, f.proposal.id), /Rollback conflict/); assert.equal(readFileSync(p, 'utf8'), edited);
  } finally { f.cleanup(); }
});
test('session pointer defers apply without changing accepted guidance', () => {
  const f = fixture(); try {
    prepared(f); mkdirSync(join(f.root, '.omx/state'), { recursive: true }); writeFileSync(join(f.root, '.omx/state/session.json'), '{}');
    assert.throws(() => apply(f.root, f.proposal.id), /session pointer/); assert.equal(status(f.root).entries, 0);
  } finally { f.cleanup(); }
});
test('project path traversal and symlink evidence cannot escape', () => {
  const f = fixture(); try {
    for (const path of ['../outside', '/etc/passwd']) assert.throws(() => recordIncident(f.root, { ...f.incident, evidence: [{ path, sha256: '0'.repeat(64) }] }), /inside|relative/);
    symlinkSync('/etc/passwd', join(f.root, 'linked')); assert.throws(() => recordIncident(f.root, { ...f.incident, evidence: [{ path: 'linked', sha256: '0'.repeat(64) }] }), /Symlink/);
  } finally { f.cleanup(); }
});
test('a symlink control directory is refused before any external write', () => {
  const root = mkdtempSync(join(tmpdir(), 'omx-control-link-')), other = mkdtempSync(join(tmpdir(), 'omx-control-target-'));
  try { symlinkSync(other, join(root, '.omx')); assert.throws(() => initEvolution(root), /Symlink/); assert.deepEqual(status(other).proposals, []); }
  finally { rmSync(root, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); }
});
test('recovery completes a partial transaction once and protects conflicting edits', () => {
  const f = fixture(); try {
    prepared(f);
    const state = join(f.root, '.omx/evolution/ledger.json'), beforeLedger = readFileSync(state, 'utf8'), data = JSON.parse(beforeLedger), item = data.proposals[0];
    item.state = 'applied';
    const tx = { schemaVersion: 1, beforeGuidance: item.base, afterGuidance: item.candidate, beforeLedger, afterLedger: JSON.stringify(data) };
    writeFileSync(join(f.root, '.omx/evolution/transaction.json'), JSON.stringify(tx));
    writeFileSync(join(f.root, '.omx-project/guidance.json'), tx.afterGuidance);
    assert.match(evolutionContext(f.root, 'test'), /pending recovery/);
    assert.throws(() => apply(f.root, f.proposal.id), /Pending transaction/);
    assert.equal(recover(f.root).state, 'recovered'); assert.equal(status(f.root).proposals[0]!.state, 'applied');
    assert.equal(recover(f.root).state, 'no-pending-transaction');
    writeFileSync(join(f.root, '.omx/evolution/transaction.json'), JSON.stringify(tx));
    writeFileSync(join(f.root, '.omx-project/guidance.json'), 'user edit');
    assert.throws(() => recover(f.root), /Recovery conflict/);
  } finally { f.cleanup(); }
});
test('live writer lock is never reaped', () => {
  const f = fixture(); try {
    mkdirSync(join(f.root, '.omx/evolution/lock')); writeFileSync(join(f.root, '.omx/evolution/lock/owner.json'), JSON.stringify({ pid: process.pid }));
    assert.throws(() => recover(f.root), /still alive/); assert.equal(existsSync(join(f.root, '.omx/evolution/lock')), true);
  } finally { f.cleanup(); }
});
test('context budgets omit complete entries instead of cutting instructions in half', () => {
  const f = fixture(); try {
    const p = join(f.root, '.omx-project/policy.json'), data = JSON.parse(readFileSync(p, 'utf8')); data.contextChars = 512; writeFileSync(p, JSON.stringify(data));
    writeFileSync(join(f.root, '.omx-project/guidance.json'), JSON.stringify({ schemaVersion: 1, entries: [{ ...f.proposal.entry, content: 'x'.repeat(1000) }] }));
    const context = evolutionContext(f.root, 'test'); assert.ok(context.length <= 512); assert.match(context, /omitted/); assert.doesNotMatch(context, /xxxx/);
  } finally { f.cleanup(); }
});
test('invalid config is surfaced to hooks without replacing upstream behavior', () => {
  const f = fixture(); try { writeFileSync(join(f.root, '.omx-project/guidance.json'), 'invalid'); assert.match(safeEvolutionContext(f.root), /invalid configuration/); } finally { f.cleanup(); }
});
test('CLI and native hook deliver accepted guidance in a fresh process', () => {
  const f = fixture(); try {
    prepared(f); apply(f.root, f.proposal.id);
    const result = spawnSync(process.execPath, [cli, 'evolve', 'hook'], { cwd: f.root, encoding: 'utf8', input: JSON.stringify({ cwd: f.root, hook_event_name: 'UserPromptSubmit', prompt: 'run tests' }) });
    assert.equal(result.status, 0, result.stderr); assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /node checks.mjs/);
    const unrelated = spawnSync(process.execPath, [cli, 'evolve', 'hook'], { cwd: f.root, encoding: 'utf8', input: JSON.stringify({ cwd: f.root, hook_event_name: 'UserPromptSubmit', prompt: 'write a poem' }) });
    assert.equal(unrelated.stdout.trim(), '{}');
  } finally { f.cleanup(); }
});

test('opted-in session startup explains the evolution workflow before any findings exist', () => {
  const f = fixture(); try { assert.match(evolutionWorkflow(f.root), /record\/propose/); assert.equal(status(f.root).incidents, 0); } finally { f.cleanup(); }
});
test('unclean launch settlement never applies and clean settlement applies evaluated correction', () => {
  const f = fixture(); try {
    prepared(f); assert.equal(settleEvolution(f.root, false).state, 'deferred-unclean-exit'); assert.equal(status(f.root).entries, 0);
    assert.equal(settleEvolution(f.root, true).state, 'applied'); assert.equal(status(f.root).entries, 1);
    assert.equal(settleEvolution(f.root, true).state, 'observing');
  } finally { f.cleanup(); }
});
test('pending evaluation cannot be applied by clean settlement', () => {
  const f = fixture(); try { recordIncident(f.root, f.incident); propose(f.root, f.proposal); assert.equal(settleEvolution(f.root, true).state, 'observing'); assert.equal(status(f.root).entries, 0); } finally { f.cleanup(); }
});
test('SIGKILL after guidance replacement recovers the same journal without losing subsequent edits', () => {
  const f = fixture(); try {
    prepared(f);
    const module = new URL('../service.js', import.meta.url).href;
    const code = `import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';
const original=fs.renameSync;fs.renameSync=(from,to)=>{if(to.endsWith('/ledger.json'))process.kill(process.pid,'SIGKILL');return original(from,to)};syncBuiltinESMExports();
const{apply}=await import(${JSON.stringify(module)});apply(${JSON.stringify(f.root)},'fix-test');`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
    assert.equal(child.signal, 'SIGKILL', child.stderr);
    assert.equal(existsSync(join(f.root, '.omx/evolution/transaction.json')), true);
    assert.equal(recover(f.root).state, 'recovered'); assert.equal(status(f.root).proposals[0]!.state, 'applied');
    assert.equal(rollback(f.root, f.proposal.id).state, 'rolledBack');
  } finally { f.cleanup(); }
});
test('the actual OMX prompt hook includes applicable accepted project guidance', async () => {
  const f = fixture(); try {
    prepared(f); apply(f.root, f.proposal.id);
    const { dispatchCodexNativeHook } = await import('../../scripts/codex-native-hook.js');
    const result = await dispatchCodexNativeHook({ hook_event_name: 'UserPromptSubmit', cwd: f.root, session_id: 'adaptive-hook-test', prompt: 'run project tests', available_tools: [] });
    assert.match(JSON.stringify(result.outputJson), /node checks.mjs/);
  } finally { f.cleanup(); }
});
