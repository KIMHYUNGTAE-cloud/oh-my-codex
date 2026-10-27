import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { apply, digest, evaluate, evolutionWorkflow, initEvolution, propose, recordIncident, recover, rollback, status } from '../service.js';
import { skillSourceDigest } from '../skills.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'adaptive-skill-evolution-'));
  initEvolution(root);
  writeFileSync(join(root, 'evidence.txt'), 'The project deployment checklist repeatedly missed schema validation.');
  writeFileSync(join(root, 'stable.txt'), 'stable');
  writeFileSync(join(root, 'check.mjs'), `import fs from 'node:fs';
if (process.argv[2] === 'reproduce') process.exit(fs.existsSync('.agents/skills/adaptive-schema-check/SKILL.md') ? 0 : 1);
process.exit(fs.readFileSync('stable.txt', 'utf8') === 'stable' ? 0 : 1);`);
  const policyPath = join(root, '.omx-project/policy.json');
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  policy.checks = ['reproduce', 'regression'].map(kind => ({ id: kind, kind, categories: ['skills'], command: process.execPath,
    args: ['check.mjs', kind], timeoutMs: 3000 }));
  writeFileSync(policyPath, JSON.stringify(policy));
  recordIncident(root, { id: 'missing-check', sessionId: 's', taskId: 't', type: 'user-correction',
    summary: 'A reusable schema check is needed', evidence: [{ path: 'evidence.txt', sha256: digest(readFileSync(join(root, 'evidence.txt'))) }] });
  const source = { content: 'Inspect the schema and its consumers. Run the project schema check before reporting success.' };
  const skill = { id: 'schema-check', purpose: 'Verify schema compatibility', activation: ['Schema or migration changes'],
    compatibility: { runtimes: ['codex'], scope: 'project' }, dependencies: [],
    provenance: { kind: 'project', origin: 'verified project procedure' }, source: { ...source, digest: skillSourceDigest(source) } };
  const input = { id: 'add-skill', incidentIds: ['missing-check'], reason: 'Make the verified check reusable',
    skills: { schemaVersion: 1, skills: [skill] } };
  return { root, input, policyPath, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('skill proposal evaluates, applies only explicitly, and rolls back all project artifacts', () => {
  const f = fixture();
  try {
    propose(f.root, f.input);
    assert.equal(evaluate(f.root, f.input.id).state, 'ready');
    assert.throws(() => apply(f.root, f.input.id, true), /category disabled/);
    apply(f.root, f.input.id);
    assert.equal(status(f.root).skills, 1);
    const output = join(f.root, '.agents/skills/adaptive-schema-check/SKILL.md');
    assert.match(readFileSync(output, 'utf8'), /Verify schema compatibility/);
    rollback(f.root, f.input.id);
    assert.equal(status(f.root).skills, 0);
    assert.equal(existsSync(output), false);
  } finally { f.cleanup(); }
});

test('skill artifact edits block rollback and later replacement', () => {
  const f = fixture();
  try {
    propose(f.root, f.input); evaluate(f.root, f.input.id); apply(f.root, f.input.id);
    const output = join(f.root, '.agents/skills/adaptive-schema-check/SKILL.md');
    writeFileSync(output, 'user edit');
    assert.throws(() => rollback(f.root, f.input.id), /Rollback conflict/);
    assert.throws(() => propose(f.root, { ...f.input, id: 'remove-skill', skills: { schemaVersion: 1, skills: [] } }), /Generated skill conflict/);
    assert.equal(readFileSync(output, 'utf8'), 'user edit');
  } finally { f.cleanup(); }
});

test('a skill cannot be retired while an applied project role still requires it', () => {
  const f = fixture();
  try {
    propose(f.root, f.input); evaluate(f.root, f.input.id); apply(f.root, f.input.id);
    const role = { id: 'schema-auditor', purpose: 'Check schemas', activation: ['Schema changes'], capabilities: ['schema'],
      skills: ['schema-check'], inputs: ['Schema'], outputs: ['Findings'], instructions: 'Check the schema.',
      verification: ['Run checker'], modelTier: 'balanced', scope: 'read-only' };
    writeFileSync(join(f.root, '.omx-project/roles.json'), JSON.stringify({ schemaVersion: 1, roles: [role] }));
    assert.throws(() => propose(f.root, { ...f.input, id: 'remove-required', skills: { schemaVersion: 1, skills: [] } }),
      /still required by project role/);
  } finally { f.cleanup(); }
});

test('guidance-only checks cannot qualify a skill proposal', () => {
  const f = fixture();
  try {
    const policy = JSON.parse(readFileSync(f.policyPath, 'utf8'));
    policy.checks.forEach((check: { categories: string[] }) => { check.categories = ['guidance']; });
    writeFileSync(f.policyPath, JSON.stringify(policy));
    propose(f.root, f.input);
    assert.throws(() => evaluate(f.root, f.input.id), /reproduce and regression/);
  } finally { f.cleanup(); }
});

test('project workflow describes explicit skill discovery and evaluated adoption', () => {
  const f = fixture();
  try {
    const workflow = evolutionWorkflow(f.root);
    assert.match(workflow, /evolve find-skills --query/);
    assert.match(workflow, /independent regression/);
    assert.match(workflow, /Do not install a remote skill directly/);
  } finally { f.cleanup(); }
});

test('skill transaction journal recovers after an interrupted multi-file apply', () => {
  const f = fixture();
  try {
    propose(f.root, f.input); evaluate(f.root, f.input.id);
    const script = `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const rename=fs.renameSync;fs.renameSync=(a,b)=>{rename(a,b);if(String(b).endsWith('adaptive-schema-check/SKILL.md'))process.kill(process.pid,'SIGKILL');};syncBuiltinESMExports();
const {apply}=await import(${JSON.stringify(new URL('../service.js', import.meta.url).href)});apply(${JSON.stringify(f.root)},'add-skill');`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { PATH: process.env.PATH, HOME: f.root, CODEX_HOME: join(f.root, 'home') } });
    assert.equal(child.signal, 'SIGKILL');
    assert.equal(status(f.root).pendingRecovery, true);
    assert.equal(recover(f.root).state, 'recovered');
    assert.equal(status(f.root).skills, 1);
    rollback(f.root, f.input.id);
  } finally { f.cleanup(); }
});
