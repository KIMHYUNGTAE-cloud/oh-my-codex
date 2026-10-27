import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearModelCandidates, createPlan, initStaffing, listModelCandidates, readPlan, setModelCandidates, assertPlanCurrent, STAFFING_POLICY, type PlanInput } from '../planner.js';
import { type HostCatalog } from '../host.js';
import { type ProjectRole } from '../roles.js';
import { digest, initEvolution } from '../service.js';
import { launchPlan, observePlan, summarizeEvents, teamInputs } from '../execution.js';
import { adaptiveCliCommand, adaptiveTaskIdMap, bindAdaptiveCli, pinAdaptiveLaunchArgs, validateAdaptiveWorkers } from '../../team/adaptive-contract.js';
import { parseTeamWorkerLaunchArgs } from '../../team/model-contract.js';
import { buildWorkerLaunchPolicyPlan } from '../../team/runtime.js';
import { compileSkills, skillSourceDigest } from '../skills.js';

const parent = { model: 'fixture-main', effort: 'medium' as const };
const catalog = (): HostCatalog => ({ schemaVersion: 1, source: 'codex-model-list', observedAt: new Date().toISOString(), models: [
  { id: 'fixture-main', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', description: 'fixture' },
  { id: 'fixture-small', efforts: ['low', 'high'], defaultEffort: 'low', description: 'fixture' },
] });
const role: ProjectRole = { id: 'schema-auditor', purpose: 'Audit schemas', activation: ['Schema work'], capabilities: ['schema'],
  inputs: ['Schema'], outputs: ['Findings'], instructions: 'Check compatibility and cite evidence.', verification: ['Check consumer'], modelTier: 'economy', scope: 'read-only' };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'adaptive-planner-')); initEvolution(root); initStaffing(root);
  writeFileSync(join(root, 'schema.txt'), 'A: string');
  const input: PlanInput = { id: 'case-one', goal: 'Audit schema', parent, mode: 'auto', mainContextTokens: 100000,
    tasks: [{ id: 'schema', description: 'Check the schema', capabilities: ['schema'], minTier: 'economy', scope: 'read-only',
      context: ['schema.txt'], writes: [], dependsOn: [], estimatedWorkTokens: 500, outputTokens: 100, verification: ['Assert consumer compatibility'] }], roleDrafts: [role] };
  const policyPath = join(root, STAFFING_POLICY), policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  policy.profiles.economy = { model: 'fixture-small', effort: 'high', workTokenFactor: 1 };
  policy.maxEstimatedTokens = 1000000;
  writeFileSync(policyPath, JSON.stringify(policy));
  return { root, input, policy, savePolicy() { writeFileSync(policyPath, JSON.stringify(policy)); }, cleanup() { rmSync(root, { recursive: true, force: true }); } };
}
test('a capability gap creates only a task-scoped role and selects a compatible economy model', () => {
  const f = fixture(); try {
    const plan = createPlan(f.root, f.input, catalog()); assert.equal(plan.mode, 'specialist');
    assert.equal(plan.workers[0]!.roleSource, 'task-draft'); assert.deepEqual(plan.workers[0]!.model, { model: 'fixture-small', effort: 'high' });
    assert.equal(existsSync(join(f.root, '.omx-project/roles.json')), false);
    assert.equal(existsSync(join(f.root, '.codex/agents/adaptive-schema-auditor.toml')), false);
    assert.equal(plan.draftRoles.length, 1);
    assert.ok(plan.estimates.selected < plan.estimates.direct);
  } finally { f.cleanup(); }
});
test('project model candidates constrain automatic and explicit worker assignments', () => {
  const f = fixture(); try {
    const input = { candidates: [{ model: 'fixture-small', tier: 'economy', efforts: ['low'] }] };
    f.policy.profiles.economy = { model: 'inherit', effort: 'inherit', workTokenFactor: 1 };
    f.savePolicy();
    assert.deepEqual(setModelCandidates(f.root, input, catalog()), input);
    assert.deepEqual(listModelCandidates(f.root), input);
    const plan = createPlan(f.root, f.input, catalog());
    assert.deepEqual(plan.workers[0]?.model, { model: 'fixture-small', effort: 'low' });
    assert.equal(plan.workers[0]?.modelSource, 'project-tier');
    assert.throws(() => createPlan(f.root, { ...f.input, id: 'forbidden-model', tasks: [{ ...f.input.tasks[0]!, model: parent }] }, catalog()), /outside project candidates/);
    assert.throws(() => setModelCandidates(f.root, { candidates: [{ model: 'fixture-small', tier: 'economy', efforts: ['medium'] }] }, catalog()), /Unsupported candidate effort/);
    assert.deepEqual(listModelCandidates(f.root), input);
    assert.deepEqual(clearModelCandidates(f.root), { candidates: [] });
  } finally { f.cleanup(); }
});
test('a matching existing role is reused before a new draft', () => {
  const f = fixture(); try {
    writeFileSync(join(f.root, '.omx-project/roles.json'), JSON.stringify({ schemaVersion: 1, roles: [role] }));
    f.input.roleDrafts = [{ ...role, id: 'redundant-role' }];
    const p = createPlan(f.root, f.input, catalog()); assert.equal(p.workers[0]!.roleSource, 'project'); assert.equal(p.draftRoles.length, 0);
  } finally { f.cleanup(); }
});
test('roles bind only applied project skills and plans pin generated skill bytes', () => {
  const f = fixture();
  try {
    const source = { content: 'Check the schema against every consumer.' };
    const projectSkill = { id: 'schema-check', purpose: 'Check schema consumers', activation: ['Schema changes'],
      compatibility: { runtimes: ['codex'], scope: 'project' }, dependencies: [], provenance: { kind: 'project', origin: 'team procedure' },
      source: { ...source, digest: skillSourceDigest(source) } };
    const files = compileSkills({ schemaVersion: 1, skills: [projectSkill] });
    for (const [path, content] of files) {
      const full = join(f.root, path); mkdirSync(join(full, '..'), { recursive: true }); writeFileSync(full, content);
    }
    f.input.roleDrafts = [{ ...role, skills: ['schema-check'] }];
    const plan = createPlan(f.root, f.input, catalog());
    assert.match(plan.workers[0]!.instructions, /adaptive-schema-check/);
    const skillPath = '.agents/skills/adaptive-schema-check/SKILL.md';
    assert.equal(plan.configurationHashes[skillPath], digest(files.get(skillPath)!));
    writeFileSync(join(f.root, skillPath), 'changed');
    assert.throws(() => assertPlanCurrent(f.root, plan), /Plan input changed/);
  } finally { f.cleanup(); }
});
test('role cannot claim an absent project skill', () => {
  const f = fixture();
  try {
    f.input.roleDrafts = [{ ...role, skills: ['missing-skill'] }];
    assert.throws(() => createPlan(f.root, f.input, catalog()), /missing project skill/);
  } finally { f.cleanup(); }
});
test('small work remains direct and compatible tasks share one worker', () => {
  const f = fixture(); try {
    const p = createPlan(f.root, { ...f.input, mainContextTokens: 0 }, catalog()); assert.equal(p.mode, 'direct'); assert.equal(p.draftRoles.length, 0);
    const p2 = createPlan(f.root, { ...f.input, id: 'combined', tasks: [...f.input.tasks, { ...f.input.tasks[0]!, id: 'consumer' }] }, catalog());
    assert.equal(p2.mode, 'specialist'); assert.deepEqual(p2.workers[0]!.taskIds, ['schema', 'consumer']);
    assert.equal(p2.workers[0]!.instructions.split('--- schema.txt sha256:').length, 2);
  } finally { f.cleanup(); }
});
test('measured team overhead prevents sending a tiny two-task audit to multiple workers', () => {
  const f = fixture(); try {
    const p = createPlan(f.root, { ...f.input, mainContextTokens: 16000,
      tasks: [...f.input.tasks, { ...f.input.tasks[0]!, id: 'other', capabilities: ['other'] }],
      roleDrafts: [role, { ...role, id: 'other-auditor', capabilities: ['other'] }] }, catalog());
    assert.equal(p.mode, 'direct'); assert.ok(p.estimates.candidates[1]!.tokens! > p.estimates.direct);
    assert.equal(p.estimates.method, 'repeated-input-plus-declared-work-v2');
  } finally { f.cleanup(); }
});
test('separate independent capabilities form a bounded team with per-task quality floors', () => {
  const f = fixture(); try {
    const second = { ...f.input.tasks[0]!, id: 'design', capabilities: ['design'], minTier: 'deep' as const };
    const p = createPlan(f.root, { ...f.input, tasks: [...f.input.tasks, second], roleDrafts: [role, { ...role, id: 'designer-local', capabilities: ['design'] }] }, catalog());
    assert.equal(p.mode, 'team'); assert.equal(p.workers.length, 2);
    assert.equal(p.workers[0]!.model.model, 'fixture-small'); assert.deepEqual(p.workers[1]!.model, parent);
    const transport = teamInputs(p); assert.equal(transport.tasks[1]!.owner, 'worker-2');
    assert.equal(transport.workers[1]!.model, 'fixture-main');
    assert.equal(transport.tasks[0]!.delegation.mode, 'none'); assert.equal(transport.tasks[0]!.coordination!.mode, 'lightweight');
  } finally { f.cleanup(); }
});
test('adaptive protocol binds the local CLI and dependencies use actual allocated task IDs', () => {
  const protocol = bindAdaptiveCli('Run `omx team api claim-task` then `omx team api transition-task-status`.');
  assert.ok(protocol.includes(adaptiveCliCommand)); assert.equal(/\bomx team\b/.test(protocol), false);
  assert.deepEqual(adaptiveTaskIdMap([{ symbolic_id: 'a' }, { symbolic_id: 'b' }], [{ id: '7' }, { id: '9' }]), { a: '7', b: '9' });
});
test('overlapping ownership and serial-only dependencies do not start an artificial team', () => {
  const f = fixture(); try {
    const tasks = [{ ...f.input.tasks[0]!, scope: 'workspace-write' as const, writes: ['src'] },
      { ...f.input.tasks[0]!, id: 'b', capabilities: ['b'], scope: 'workspace-write' as const, writes: ['src/file.ts'] }];
    const roles = [{ ...role, scope: 'workspace-write' as const }, { ...role, id: 'b-role', capabilities: ['b'], scope: 'workspace-write' as const }];
    const p = createPlan(f.root, { ...f.input, tasks, roleDrafts: roles }, catalog()); assert.equal(p.mode, 'direct'); assert.match(p.reason, /Overlapping/);
    tasks[1]!.writes = ['other']; tasks[1]!.dependsOn = ['schema'];
    const p2 = createPlan(f.root, { ...f.input, id: 'serial', tasks, roleDrafts: roles }, catalog()); assert.equal(p2.mode, 'direct'); assert.match(p2.reason, /No independent/);
  } finally { f.cleanup(); }
});
test('explicit model/effort wins but unsupported combinations fail instead of silently falling back', () => {
  const f = fixture(); try {
    f.input.tasks[0]!.model = parent;
    assert.deepEqual(createPlan(f.root, f.input, catalog()).workers[0]!.model, parent);
    f.input.tasks[0]!.model = { model: 'fixture-small', effort: 'medium' };
    assert.throws(() => createPlan(f.root, { ...f.input, id: 'bad-effort' }, catalog()), /Unsupported effort/);
    f.input.tasks[0]!.model.model = 'missing';
    assert.throws(() => createPlan(f.root, { ...f.input, id: 'missing-model' }, catalog()), /absent from host/);
  } finally { f.cleanup(); }
});
test('budget, missing role, context limit and dependency cycles are explicit constraints', () => {
  const f = fixture(); try {
    assert.throws(() => createPlan(f.root, { ...f.input, mode: 'specialist', roleDrafts: [] }, catalog()), /Missing roles/);
    assert.throws(() => createPlan(f.root, { ...f.input, tasks: [{ ...f.input.tasks[0]!, dependsOn: ['schema'] }] }, catalog()), /cycle/);
    f.policy.maxEstimatedTokens = 1000; f.savePolicy();
    assert.throws(() => createPlan(f.root, f.input, catalog()), /token budget/);
    f.policy.maxEstimatedTokens = 40000; f.policy.maxContextChars = 1000; f.savePolicy(); writeFileSync(join(f.root, 'schema.txt'), 'a'.repeat(2000));
    assert.throws(() => createPlan(f.root, { ...f.input, mode: 'specialist' }, catalog()), /context budget/);
  } finally { f.cleanup(); }
});
test('saved plans are immutable and source or policy drift blocks dispatch', () => {
  const f = fixture(); try {
    const p = createPlan(f.root, f.input, catalog());
    assert.throws(() => createPlan(f.root, f.input, catalog()), /already exists/);
    f.input.parent!.model = 'changed'; assert.deepEqual(readPlan(f.root, p.id).parent, { model: 'fixture-main', effort: 'medium' });
    writeFileSync(join(f.root, 'schema.txt'), 'Changed schema'); assert.throws(() => assertPlanCurrent(f.root, p), /input changed/);
  } finally { parent.model = 'fixture-main'; f.cleanup(); }
});
test('stale catalogs and corrupt snapshots are refused', () => {
  const f = fixture(); try {
    assert.throws(() => createPlan(f.root, f.input, { ...catalog(), observedAt: '2020-01-01T00:00:00.000Z' }), /stale/);
    const p = createPlan(f.root, f.input, catalog()); p.workers[0]!.model.model = 'tampered';
    writeFileSync(join(f.root, '.omx/evolution/plans/case-one.json'), JSON.stringify(p)); assert.throws(() => readPlan(f.root, p.id), /Invalid plan/);
  } finally { f.cleanup(); }
});
test('runtime pins both model axes, preserves permission flags, and disables nested delegation', () => {
  const spec = { workerName: 'worker-1', role: 'adaptive-a', model: 'fixture-small', effort: 'high' as const, instructions: 'Do task' };
  const args = pinAdaptiveLaunchArgs(['--model', 'old', '-c', 'model_reasoning_effort="low"', '--sandbox', 'read-only', '--ask-for-approval', 'never'], spec);
  const parsed = parseTeamWorkerLaunchArgs(args); assert.equal(parsed.modelOverride, 'fixture-small');
  assert.equal(parsed.reasoningOverride, 'model_reasoning_effort="high"'); assert.equal(parsed.sandboxValue, 'read-only'); assert.equal(parsed.approvalValue, 'never');
  assert.ok(args.includes('agents.enabled=false')); assert.equal(parsed.wantsBypass, false);
  assert.throws(() => validateAdaptiveWorkers([spec], 2), /count/);
});
test('the actual OMX runtime launch planner uses frozen per-worker settings after defaults change', () => {
  const f = fixture(); try {
    const p = createPlan(f.root, f.input, catalog()), inputs = teamInputs(p);
    const result = buildWorkerLaunchPolicyPlan({ workerCount: 1, tasks: inputs.tasks, agentType: 'executor', adaptiveWorkers: inputs.workers,
      launchEnv: { HOME: f.root, CODEX_HOME: f.root, OMX_TEAM_WORKER_CLI: 'codex', OMX_TEAM_WORKER_INHERITED_MODEL: 'new-default',
        OMX_TEAM_WORKER_LAUNCH_ARGS: '--model "new-default" -c model_reasoning_effort="xhigh" --sandbox read-only --ask-for-approval never' }, codexHomeOverride: f.root });
    const parsed = parseTeamWorkerLaunchArgs([...result[0]!.workerLaunchArgs]);
    assert.equal(parsed.modelOverride, 'fixture-small'); assert.equal(parsed.reasoningOverride, 'model_reasoning_effort="high"'); assert.equal(parsed.sandboxValue, 'read-only');
    assert.equal(result[0]!.workerRole, 'adaptive-schema-auditor');
  } finally { f.cleanup(); }
});
test('direct dispatch launches no processes and cannot dispatch the same plan twice', async () => {
  const f = fixture(); try {
    const p = createPlan(f.root, { ...f.input, mainContextTokens: 0 }, catalog());
    assert.equal((await launchPlan(f.root, p.id)).state, 'direct');
    await assert.rejects(launchPlan(f.root, p.id), /already dispatched/);
  } finally { f.cleanup(); }
});
test('observations include leader overhead, leave missing usage unknown, and detect wrong observed model', () => {
  const f = fixture(); try {
    const p = createPlan(f.root, f.input, catalog());
    const log = JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 20 } }) + '\n';
    writeFileSync(join(f.root, 'worker.jsonl'), log); writeFileSync(join(f.root, 'leader.jsonl'), log);
    writeFileSync(join(f.root, 'verified.txt'), 'consumer check passed');
    const input = { workers: [{ workerName: 'worker-1', eventLog: 'worker.jsonl' }], leaderEventLog: null as string | null,
      verification: [{ path: 'verified.txt', sha256: digest('consumer check passed'), passed: true }], reworkTaskIds: [] };
    let report = observePlan(f.root, p.id, input); assert.equal(report.usageComplete, false); assert.equal(report.totalTokens, null); assert.equal(report.knownTokens, 120);
    input.leaderEventLog = 'leader.jsonl'; report = observePlan(f.root, p.id, input); assert.equal(report.totalTokens, 240); assert.equal(report.savings, 'not-established');
    writeFileSync(join(f.root, 'worker.jsonl'), JSON.stringify({ type: 'turn_context', payload: { model: 'wrong-model', effort: 'low' } }) + '\n' + log);
    assert.equal(observePlan(f.root, p.id, input).modelMismatch, true);
    input.leaderEventLog = './worker.jsonl'; assert.throws(() => observePlan(f.root, p.id, input), /counted twice/);
    assert.equal(summarizeEvents('{}\n').usage, null);
  } finally { f.cleanup(); }
});
test('completed verified model observations conservatively raise future overhead estimates', () => {
  const f = fixture(); try {
    const first = createPlan(f.root, f.input, catalog());
    const events = [
      { type: 'turn_context', payload: { model: 'fixture-small', effort: 'high' } },
      { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 60000, output_tokens: 200 }, last_token_usage: { input_tokens: 30000, output_tokens: 100 } } } },
      { type: 'event_msg', payload: { type: 'task_complete' } },
    ].map(e => JSON.stringify(e)).join('\n');
    writeFileSync(join(f.root, 'events.jsonl'), events); writeFileSync(join(f.root, 'verified.txt'), 'passed');
    observePlan(f.root, first.id, { workers: [{ workerName: 'worker-1', eventLog: 'events.jsonl' }], leaderEventLog: null,
      verification: [{ path: 'verified.txt', sha256: digest('passed'), passed: true }], reworkTaskIds: [] });
    const next = createPlan(f.root, { ...f.input, id: 'calibrated' }, catalog());
    assert.equal(next.calibration.length, 1); assert.equal(next.calibration[0]!.inputTokensPerCall, 30000);
    assert.equal(next.mode, 'direct');
    writeFileSync(join(f.root, 'events.jsonl'), 'changed');
    assert.equal(createPlan(f.root, { ...f.input, id: 'expired-proof' }, catalog()).calibration.length, 0);
  } finally { f.cleanup(); }
});
test('partial rollout usage is accounted as known usage but never called complete', () => {
  const result = summarizeEvents(JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 5 } } } }));
  assert.equal(result.usage!.totalTokens, 105); assert.equal(result.usage!.cachedInputTokens, null); assert.equal(result.complete, false);
});
