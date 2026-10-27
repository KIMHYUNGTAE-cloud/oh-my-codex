/** Project-local evolution. No model calls, setup, global config, or session ownership. */
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, openSync, closeSync, fsyncSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { compileRoles, EMPTY_ROLES, isRoleArtifact, ROLES, rolesSchema } from './roles.js';
import { compileSkills, EMPTY_SKILLS, isSkillArtifact, SKILLS, skillsSchema } from './skills.js';

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const text = z.string().trim().min(1).max(8000);
const kinds = z.enum(['knowledge', 'instruction', 'procedure']);
const categories = z.enum(['knowledge', 'instruction', 'procedure', 'roles', 'skills']);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const evidenceSchema = z.object({ path: text, sha256: hash }).strict();
const incidentSchema = z.object({ id, sessionId: text, taskId: text,
  type: z.enum(['user-correction', 'verified-finding', 'harness-issue']), summary: text,
  evidence: z.array(evidenceSchema).min(1).max(10) }).strict();
const entrySchema = z.object({ id, kind: kinds, title: z.string().min(1).max(120), content: text,
  when: z.array(z.string().trim().min(1).max(100)).max(20) }).strict();
const proposalShape = z.object({ id, incidentIds: z.array(id).min(1).max(20), entry: entrySchema.optional(),
  roles: rolesSchema.optional(), skills: skillsSchema.optional(), reason: text }).strict();
const proposalInput = proposalShape.refine(v => [v.entry, v.roles, v.skills].filter(Boolean).length === 1, 'Specify exactly one of entry, roles or skills');
const fileChangeSchema = z.object({ path: z.string().refine(v => isRoleArtifact(v) || isSkillArtifact(v), 'Invalid evolution artifact'),
  before: z.string().max(1_000_000).nullable(), after: z.string().max(1_000_000).nullable() }).strict();
type FileChange = z.infer<typeof fileChangeSchema>;
const checkSchema = z.object({ id, kind: z.enum(['reproduce', 'regression']),
  command: z.string().min(1).max(2000), args: z.array(z.string().max(4000)).max(30),
  timeoutMs: z.number().int().min(100).max(180000).default(30000),
  categories: z.array(z.enum(['guidance', 'roles', 'skills'])).min(1).max(3).optional() }).strict();
const policySchema = z.object({ schemaVersion: z.literal(1), enabled: z.boolean(),
  autoApply: z.array(categories).max(5), repeatThreshold: z.number().int().min(2).max(20),
  distinctTasks: z.number().int().min(2).max(20), contextChars: z.number().int().min(512).max(12000),
  checks: z.array(checkSchema).max(8) }).strict();
const automationSchema = z.object({ schemaVersion: z.literal(1), enabled: z.boolean() }).strict();
export const AUTOMATION = '.omx-project/automation.json';
const guidanceSchema = z.object({ schemaVersion: z.literal(1), entries: z.array(entrySchema).max(100) }).strict();
type Entry = z.infer<typeof entrySchema>;
type Incident = z.infer<typeof incidentSchema>;
type Policy = z.infer<typeof policySchema>;
interface CheckResult { id: string; kind: 'reproduce' | 'regression'; baseline: number | null; candidate: number | null;
  baselineOutputSha256: string; candidateOutputSha256: string; }
interface Evaluation { sourceDigest: string; policyDigest: string; candidateDigest: string;
  checks: CheckResult[]; passed: boolean; taskQuality: 'validator-defined'; }
interface Proposal extends z.infer<typeof proposalInput> { base: string; candidate: string;
  files?: FileChange[]; state: 'proposed' | 'ready' | 'applied' | 'rolledBack'; evaluation?: Evaluation; }
interface Ledger { schemaVersion: 1; incidents: Incident[]; proposals: Proposal[]; }
interface Transaction { schemaVersion: 1; beforeGuidance: string; afterGuidance: string;
  beforeLedger: string; afterLedger: string; }
interface MultiTransaction { schemaVersion: 2; files: FileChange[]; beforeLedger: string; afterLedger: string; }
function category(item: { entry?: Entry; roles?: unknown; skills?: unknown }): 'guidance' | 'roles' | 'skills' {
  return item.roles ? 'roles' : item.skills ? 'skills' : 'guidance';
}
function catalogPath(item: { roles?: unknown; skills?: unknown }): string { return item.roles ? ROLES : item.skills ? SKILLS : GUIDANCE; }
function emptyCatalog(item: { roles?: unknown; skills?: unknown }): string { return item.roles ? EMPTY_ROLES : item.skills ? EMPTY_SKILLS : EMPTY_GUIDANCE; }
function compileCatalog(item: { roles?: unknown; skills?: unknown }, source: string): Map<string, string> {
  return item.roles ? compileRoles(JSON.parse(source)) : compileSkills(JSON.parse(source));
}
function assertRoleSkills(root: string, roles: z.infer<typeof rolesSchema>): void {
  const catalog = skillsSchema.parse(JSON.parse(read(root, SKILLS, EMPTY_SKILLS)));
  const available = new Set(catalog.skills.map(skill => skill.id));
  const generated = compileSkills(catalog);
  for (const role of roles.roles) for (const id of role.skills ?? []) {
    if (!available.has(id)) fail(`Role ${role.id} requires missing project skill: ${id}`);
    for (const [path, content] of generated) if (path.startsWith(`.agents/skills/adaptive-${id}/`) &&
      read(root, path) !== content) fail(`Role ${role.id} requires unchanged project skill artifact: ${path}`);
  }
}
function assertSkillsRetainRoleBindings(root: string, skills: z.infer<typeof skillsSchema>): void {
  const roles = rolesSchema.parse(JSON.parse(read(root, ROLES, EMPTY_ROLES)));
  const available = new Set(skills.skills.map(skill => skill.id));
  for (const role of roles.roles) for (const id of role.skills ?? []) {
    if (!available.has(id)) fail(`Skill ${id} is still required by project role ${role.id}`);
  }
}
const evaluationSchema = z.object({ sourceDigest: hash, policyDigest: hash, candidateDigest: hash,
  checks: z.array(z.object({ id, kind: z.enum(['reproduce', 'regression']), baseline: z.number().int().nullable(),
    candidate: z.number().int().nullable(), baselineOutputSha256: hash, candidateOutputSha256: hash }).strict()).min(2).max(8),
  passed: z.boolean(), taskQuality: z.literal('validator-defined') }).strict();
const ledgerSchema = z.object({ schemaVersion: z.literal(1), incidents: z.array(incidentSchema).max(1000),
  proposals: z.array(proposalShape.extend({ base: z.string().min(1).max(1_000_000), candidate: z.string().min(1).max(1_000_000),
    files: z.array(fileChangeSchema).min(1).max(161).optional(),
    state: z.enum(['proposed', 'ready', 'applied', 'rolledBack']), evaluation: evaluationSchema.optional() }).strict()
    .refine(v => [v.entry, v.roles, v.skills].filter(Boolean).length === 1, 'Invalid proposal category')).max(500) }).strict();
const POLICY = '.omx-project/policy.json';
const GUIDANCE = '.omx-project/guidance.json';
const STATE = '.omx/evolution/ledger.json';
const JOURNAL = '.omx/evolution/transaction.json';
const EMPTY_GUIDANCE = format({ schemaVersion: 1, entries: [] });
const EMPTY_LEDGER = format({ schemaVersion: 1, incidents: [], proposals: [] });
export function digest(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function format(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
function fail(message: string): never { throw new Error(message); }

/** Reject links in every traversed component, including control directories. */
export function pathFor(root: string, name: string): string {
  if (!name || name.includes('\\') || name.includes('\0')) fail('Invalid project path');
  const result = resolve(root, name), rel = relative(root, result);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || resolve(name) === name) fail('Path must be relative and inside the project');
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    if (existsSync(current) || (() => { try { return lstatSync(current).isSymbolicLink(); } catch { return false; } })()) {
      if (lstatSync(current).isSymbolicLink()) fail(`Symlink is not allowed: ${name}`);
    }
  }
  return result;
}
export function read(root: string, name: string, fallback?: string): string {
  const p = pathFor(root, name);
  if (!existsSync(p)) return fallback ?? fail(`Missing ${name}`);
  if (!lstatSync(p).isFile() || lstatSync(p).size > 2_000_000) fail(`Invalid or oversized ${name}`);
  return readFileSync(p, 'utf8');
}
export function atomic(root: string, name: string, content: string): void {
  if (Buffer.byteLength(content, 'utf8') > 2_000_000) fail('Evolution artifact exceeds 2 MB; compact history before proceeding');
  const p = pathFor(root, name); mkdirSync(dirname(p), { recursive: true });
  const temporary = `${p}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, p);
  const dir = openSync(dirname(p), 'r');
  try { fsyncSync(dir); } finally { closeSync(dir); }
}
export function locked<T>(rootInput: string, operation: (root: string) => T, recovery = false): T {
  const root = realpathSync(rootInput), lock = pathFor(root, '.omx/evolution/lock');
  mkdirSync(dirname(lock), { recursive: true });
  try { mkdirSync(lock); } catch { fail('Evolution is locked; do not delete a lock belonging to a live process'); }
  try {
    writeFileSync(join(lock, 'owner.json'), format({ pid: process.pid }));
    if (!recovery && existsSync(pathFor(root, JOURNAL))) fail('Pending transaction; run evolve recover');
    return operation(root);
  } finally { rmSync(lock, { recursive: true }); }
}
function policy(root: string): Policy { return policySchema.parse(JSON.parse(read(root, POLICY))); }
function guidance(root: string): { schemaVersion: 1; entries: Entry[] } {
  const parsed = guidanceSchema.parse(JSON.parse(read(root, GUIDANCE, EMPTY_GUIDANCE)));
  if (new Set(parsed.entries.map(e => e.id)).size !== parsed.entries.length) fail('Duplicate guidance IDs');
  return parsed;
}
function ledger(root: string): Ledger {
  const data = ledgerSchema.parse(JSON.parse(read(root, STATE, EMPTY_LEDGER)));
  if (new Set(data.incidents.map(i => i.id)).size !== data.incidents.length || new Set(data.proposals.map(p => p.id)).size !== data.proposals.length) fail('Duplicate ledger identities');
  for (const proposal of data.proposals) {
    if (proposal.incidentIds.some(i => !data.incidents.some(incident => incident.id === i))) fail('Missing incident reference');
    if (proposal.roles || proposal.skills) {
      const schema = proposal.roles ? rolesSchema : skillsSchema;
      schema.parse(JSON.parse(proposal.base)); schema.parse(JSON.parse(proposal.candidate));
      if (!proposal.files?.length || new Set(proposal.files.map(f => f.path)).size !== proposal.files.length) fail('Invalid catalog change set');
      const expected = compileCatalog(proposal, proposal.candidate);
      const previous = compileCatalog(proposal, proposal.base);
      const paths = [...new Set([...expected.keys(), ...previous.keys()])].sort();
      if (proposal.files.length !== paths.length || paths.some(path => {
        const change = proposal.files!.find(f => f.path === path);
        return !change || change.after !== (expected.get(path) ?? null) ||
          (path !== catalogPath(proposal) && change.before !== (previous.get(path) ?? null));
      }) || ![proposal.base, ...(proposal.base === emptyCatalog(proposal) ? [null] : [])].includes(proposal.files.find(f => f.path === catalogPath(proposal))!.before)) fail('Catalog artifacts do not match their source');
    } else {
      if (proposal.files) fail('Guidance proposal cannot modify catalog files');
      guidanceSchema.parse(JSON.parse(proposal.base)); guidanceSchema.parse(JSON.parse(proposal.candidate));
    }
  }
  return data;
}
function ensureEnabled(root: string): Policy { const p = policy(root); if (!p.enabled) fail('Evolution is disabled'); return p; }
function assertEvidence(root: string, incident: Incident): void {
  for (const e of incident.evidence) {
    if (e.path.startsWith('.omx/') || e.path.startsWith('.git/')) fail('Evidence must be a project artifact, not mutable runtime state');
    if (digest(read(root, e.path)) !== e.sha256) fail('Evidence changed or digest does not match');
  }
}
function snapshot(root: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>(); let bytes = 0;
  function visit(dir: string) {
    for (const item of readdirSync(join(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!dir && ['.git', '.omx', '.local-tests', 'node_modules'].includes(item.name)) continue;
      const name = dir ? `${dir}/${item.name}` : item.name, p = pathFor(root, name);
      if (item.isDirectory()) visit(name);
      else if (item.isFile()) {
        const size = lstatSync(p).size;
        if ((bytes += size) > 16_000_000 || files.size >= 2000) fail('Evaluation snapshot exceeds 16 MB / 2000 files');
        files.set(name, readFileSync(p));
      } else fail('Evaluation snapshot only supports regular files and directories');
    }
  }
  visit(''); return files;
}
function snapshotDigest(files: Map<string, Buffer>): string {
  return digest(JSON.stringify([...files].map(([name, content]) => [name, digest(content)])));
}
export function assertInactive(root: string): void {
  if (['OMX_ROOT', 'OMX_STATE_ROOT', 'OMX_TEAM_STATE_ROOT'].some(key => process.env[key])) fail('Runtime state override present; project-local apply is deferred');
  // An unresolved OMX pointer is deliberately conservative: no ownership is inferred.
  for (const name of ['.omx/state/session.json', '.omx/state/current-session.json']) {
    if (existsSync(pathFor(root, name))) fail('OMX session pointer exists; persistent evolution requires a clean session boundary');
  }
  const sessions = pathFor(root, '.omx/state/sessions');
  if (existsSync(sessions) && readdirSync(sessions).some(name => existsSync(pathFor(root, `.omx/state/sessions/${name}/session.json`)))) {
    fail('Unresolved OMX session exists; persistent evolution is deferred');
  }
  const teams = pathFor(root, '.omx/state/team');
  if (existsSync(teams) && readdirSync(teams).some(name => existsSync(pathFor(root, `.omx/state/team/${name}/config.json`)))) {
    fail('Unresolved OMX team exists; persistent evolution is deferred');
  }
}
export function initEvolution(root: string) {
  return locked(root, r => {
    if (existsSync(pathFor(r, POLICY))) return { state: 'existing', policy: POLICY };
    atomic(r, POLICY, format({ schemaVersion: 1, enabled: true, autoApply: ['knowledge', 'instruction', 'procedure'],
      repeatThreshold: 3, distinctTasks: 2, contextChars: 4000, checks: [] }));
    if (!existsSync(pathFor(r, GUIDANCE))) atomic(r, GUIDANCE, EMPTY_GUIDANCE);
    return { state: 'initialized', policy: POLICY, activation: 'next-context-read' };
  });
}
export function automationStatus(root: string) {
  const r = realpathSync(root);
  const automation = automationSchema.parse(JSON.parse(read(r, AUTOMATION, '{"schemaVersion":1,"enabled":false}')));
  const configured = existsSync(pathFor(r, POLICY)) ? policySchema.parse(JSON.parse(read(r, POLICY))) : null;
  return { ...automation, autoApply: configured?.autoApply ?? [], checksConfigured: Boolean(configured?.checks.some(c => c.kind === 'reproduce')
    && configured.checks.some(c => c.kind === 'regression')) };
}
export function setAutomation(root: string, enabled: boolean) {
  return locked(root, r => {
    const current = policySchema.parse(JSON.parse(read(r, POLICY)));
    const next = { ...current, enabled: enabled || current.enabled,
      autoApply: enabled ? ['knowledge', 'instruction', 'procedure', 'roles', 'skills'] as z.infer<typeof categories>[] : [] };
    // Enable guidance before widening auto-apply, and narrow auto-apply before
    // disabling guidance. An interrupted toggle must never leave broad
    // auto-apply active without agent-managed workflow guidance.
    if (enabled) atomic(r, AUTOMATION, format({ schemaVersion: 1, enabled }));
    atomic(r, POLICY, format(policySchema.parse(next)));
    if (!enabled) atomic(r, AUTOMATION, format({ schemaVersion: 1, enabled }));
    return automationStatus(r);
  });
}
export function recordIncident(root: string, value: unknown) {
  return locked(root, r => {
    ensureEnabled(r); const item = incidentSchema.parse(value); assertEvidence(r, item);
    const data = ledger(r), identity = (i: Incident) => JSON.stringify([i.sessionId, i.taskId, i.type, i.evidence]);
    const existing = data.incidents.find(i => i.id === item.id || identity(i) === identity(item));
    if (existing) {
      if (existing.id === item.id && format(existing) !== format(item)) fail('Incident ID conflict');
      return { id: existing.id, duplicate: true };
    }
    data.incidents.push(item); atomic(r, STATE, format(data));
    return { id: item.id, duplicate: false };
  });
}
export function propose(root: string, value: unknown) {
  return locked(root, r => {
    ensureEnabled(r); const input = proposalInput.parse(value), data = ledger(r);
    if (data.proposals.some(p => p.id === input.id)) fail('Proposal ID already exists');
    if (new Set(input.incidentIds).size !== input.incidentIds.length) fail('Duplicate incident references');
    input.incidentIds.forEach(i => { const incident = data.incidents.find(item => item.id === i); if (!incident) fail('Unknown incident'); assertEvidence(r, incident); });
    let base: string, candidate: string, files: FileChange[] | undefined;
    if (input.roles || input.skills) {
      if (input.roles) assertRoleSkills(r, input.roles);
      if (input.skills) assertSkillsRetainRoleBindings(r, input.skills);
      const sourcePath = catalogPath(input), empty = emptyCatalog(input);
      base = read(r, sourcePath, empty);
      const previous = compileCatalog(input, base), next = input.roles ? compileRoles(input.roles) : compileSkills(input.skills);
      candidate = next.get(sourcePath)!;
      files = [...new Set([...previous.keys(), ...next.keys()])].sort().map(path => {
        const before = existsSync(pathFor(r, path)) ? read(r, path) : null;
        if (path !== sourcePath && before !== (previous.get(path) ?? null)) fail(`Generated ${input.roles ? 'role' : 'skill'} conflict: ${path}`);
        return { path, before, after: next.get(path) ?? null };
      });
    } else {
      base = read(r, GUIDANCE, EMPTY_GUIDANCE); const parsed = guidance(r), entry = input.entry!;
      parsed.entries = [...parsed.entries.filter(e => e.id !== entry.id), entry].sort((a, b) => a.id.localeCompare(b.id));
      candidate = format(guidanceSchema.parse(parsed));
    }
    if (base === candidate) fail('Proposal makes no change');
    const item: Proposal = { ...input, base, candidate, ...(files ? { files } : {}), state: 'proposed' };
    data.proposals.push(item); atomic(r, STATE, format(data));
    return { id: item.id, state: item.state, baseDigest: digest(base), candidateDigest: digest(candidate) };
  });
}
function findProposal(data: Ledger, proposalId: string): Proposal { return data.proposals.find(p => p.id === proposalId) ?? fail('Unknown proposal'); }
function assertBase(root: string, item: Proposal): void {
  if (read(root, catalogPath(item), emptyCatalog(item)) !== item.base) fail('Base guidance or catalog changed');
  if (item.files?.some(f => (existsSync(pathFor(root, f.path)) ? read(root, f.path) : null) !== f.before)) fail('Generated catalog files changed');
}
export function evaluate(root: string, proposalId: string) {
  return locked(root, r => {
    const p = ensureEnabled(r), data = ledger(r), item = findProposal(data, proposalId);
    if (!['proposed', 'ready'].includes(item.state)) fail('Only unapplied proposals can be evaluated');
    if (item.roles) assertRoleSkills(r, item.roles);
    if (item.skills) assertSkillsRetainRoleBindings(r, item.skills);
    assertBase(r, item);
    const checks = p.checks.filter(c => !c.categories || c.categories.includes(category(item)));
    if (!checks.some(c => c.kind === 'reproduce') || !checks.some(c => c.kind === 'regression') || new Set(checks.map(c => c.id)).size !== checks.length) fail('Register unique reproduce and regression checks in project policy first');
    item.incidentIds.forEach(i => assertEvidence(r, data.incidents.find(x => x.id === i)!));
    const files = snapshot(r), sourceDigest = snapshotDigest(files), results: CheckResult[] = [];
    const temporary = pathFor(r, `.omx/evolution/evaluations/${randomUUID()}`);
    mkdirSync(temporary, { recursive: true });
    try {
      for (const check of checks) {
        const outcomes = [];
        for (const arm of ['baseline', 'candidate'] as const) {
          const cwd = join(temporary, `${check.id}-${arm}`); mkdirSync(cwd);
          for (const [name, content] of files) { const dest = join(cwd, name); mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, content); }
          if (arm === 'candidate') {
            if (item.files) for (const file of item.files) writeChange(cwd, file.path, file.after);
            else writeFileSync(join(cwd, GUIDANCE), item.candidate);
          }
          const home = join(cwd, '.omx/check-home'); mkdirSync(join(home, '.codex'), { recursive: true });
          // Allowlisted environment: no parent hooks, tokens, profile, or session identity.
          const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: home, CODEX_HOME: join(home, '.codex'),
            TMPDIR: process.env.TMPDIR, LANG: 'C.UTF-8', OMX_EVOLUTION_ARM: arm };
          const execution = spawnSync(process.execPath, [fileURLToPath(new URL('./check-runner.js', import.meta.url))], {
            cwd, env, timeout: check.timeoutMs + 5000, input: JSON.stringify(check),
            maxBuffer: 1_000_000, encoding: 'utf8', killSignal: 'SIGKILL' });
          outcomes.push({ code: execution.error || execution.signal || [124, 125].includes(execution.status ?? -1) ? null : execution.status,
            output: digest(`${execution.stdout ?? ''}\n${execution.stderr ?? ''}`) });
        }
        results.push({ id: check.id, kind: check.kind, baseline: outcomes[0]!.code, candidate: outcomes[1]!.code,
          baselineOutputSha256: outcomes[0]!.output, candidateOutputSha256: outcomes[1]!.output });
      }
    } finally { rmSync(temporary, { recursive: true, force: true }); }
    if (snapshotDigest(snapshot(r)) !== sourceDigest) fail('Project changed during evaluation; results discarded');
    const passed = results.every(c => c.candidate === 0 && (c.kind === 'regression' ? c.baseline === 0 : c.baseline !== null && c.baseline !== 0));
    item.evaluation = { sourceDigest, policyDigest: digest(read(r, POLICY)), candidateDigest: digest(item.candidate), checks: results, passed, taskQuality: 'validator-defined' };
    item.state = passed ? 'ready' : 'proposed'; atomic(r, STATE, format(data));
    return { id: item.id, state: item.state, evaluation: item.evaluation };
  });
}
function commit(root: string, data: Ledger, target: string): void {
  const transaction: Transaction = { schemaVersion: 1, beforeGuidance: read(root, GUIDANCE, EMPTY_GUIDANCE), afterGuidance: target,
    beforeLedger: read(root, STATE, EMPTY_LEDGER), afterLedger: format(data) };
  atomic(root, JOURNAL, format(transaction));
  finishTransaction(root, transaction);
}
function writeChange(root: string, path: string, content: string | null): void {
  if (content !== null) atomic(root, path, content);
  else {
    const target = pathFor(root, path);
    if (existsSync(target)) {
      rmSync(target); const fd = openSync(dirname(target), 'r');
      try { fsyncSync(fd); } finally { closeSync(fd); }
    }
  }
}
function commitFiles(root: string, data: Ledger, files: FileChange[]): void {
  const tx: MultiTransaction = { schemaVersion: 2, files, beforeLedger: read(root, STATE, EMPTY_LEDGER), afterLedger: format(data) };
  atomic(root, JOURNAL, format(tx)); finishTransaction(root, tx);
}
function finishTransaction(root: string, tx: Transaction | MultiTransaction): void {
  if (tx.schemaVersion === 2) {
    const files = z.array(fileChangeSchema).min(1).max(161).parse(tx.files);
    if (new Set(files.map(f => f.path)).size !== files.length) fail('Duplicate transaction paths');
    ledgerSchema.parse(JSON.parse(tx.afterLedger));
    if (![tx.beforeLedger, tx.afterLedger].includes(read(root, STATE, EMPTY_LEDGER)) || files.some(f =>
      ![f.before, f.after].includes(existsSync(pathFor(root, f.path)) ? read(root, f.path) : null))) fail('Recovery conflict: preserve subsequent user edits');
    // Check ALL preconditions before touching any target. Journal blocks new readers.
    for (const file of files) writeChange(root, file.path, file.after);
    atomic(root, STATE, tx.afterLedger); rmSync(pathFor(root, JOURNAL)); return;
  }
  if (tx.schemaVersion !== 1 || ![tx.beforeGuidance, tx.afterGuidance, tx.beforeLedger, tx.afterLedger].every(x => typeof x === 'string')) fail('Invalid transaction');
  guidanceSchema.parse(JSON.parse(tx.afterGuidance));
  ledgerSchema.parse(JSON.parse(tx.afterLedger));
  const current = read(root, GUIDANCE, EMPTY_GUIDANCE), state = read(root, STATE, EMPTY_LEDGER);
  if (![tx.beforeGuidance, tx.afterGuidance].includes(current) || ![tx.beforeLedger, tx.afterLedger].includes(state)) fail('Recovery conflict: preserve subsequent user edits');
  atomic(root, GUIDANCE, tx.afterGuidance); atomic(root, STATE, tx.afterLedger);
  rmSync(pathFor(root, JOURNAL));
}
export function apply(root: string, proposalId: string, automatic = false) {
  return locked(root, r => {
    const p = ensureEnabled(r); assertInactive(r);
    const data = ledger(r), item = findProposal(data, proposalId), evaluation = item.evaluation;
    if (item.state !== 'ready' || !evaluation?.passed) fail('Passing evaluation required');
    if (item.roles) assertRoleSkills(r, item.roles);
    if (item.skills) assertSkillsRetainRoleBindings(r, item.skills);
    try { assertBase(r, item); } catch { fail('Stale evaluation: base guidance or generated catalog changed'); }
    if (digest(item.candidate) !== evaluation.candidateDigest ||
      digest(read(r, POLICY)) !== evaluation.policyDigest || snapshotDigest(snapshot(r)) !== evaluation.sourceDigest) fail('Stale evaluation: project, policy, or candidate changed');
    const incidents = item.incidentIds.map(i => data.incidents.find(x => x.id === i)!);
    incidents.forEach(i => assertEvidence(r, i));
    if (automatic) {
      if (!p.autoApply.includes(item.roles ? 'roles' : item.skills ? 'skills' : item.entry!.kind)) fail('Automatic category disabled');
      const explicit = incidents.some(i => i.type === 'user-correction');
      if (!explicit && (incidents.length < p.repeatThreshold || new Set(incidents.map(i => `${i.sessionId}:${i.taskId}`)).size < p.distinctTasks)) fail('Insufficient independent evidence for automatic apply');
    }
    item.state = 'applied';
    if (item.files) commitFiles(r, data, item.files); else commit(r, data, item.candidate);
    return { id: item.id, state: item.state, activation: 'next-context-read', effect: 'pending-observation' };
  });
}
export function rollback(root: string, proposalId: string) {
  return locked(root, r => {
    assertInactive(r); const data = ledger(r), item = findProposal(data, proposalId);
    if (item.state !== 'applied') fail('Only applied proposals can be rolled back');
    if (item.files) {
      if (item.files.some(f => (existsSync(pathFor(r, f.path)) ? read(r, f.path) : null) !== f.after)) fail('Rollback conflict: catalog files changed after application');
      item.state = 'rolledBack'; commitFiles(r, data, item.files.map(f => ({ path: f.path, before: f.after, after: f.before })));
    } else {
      if (read(r, GUIDANCE) !== item.candidate) fail('Rollback conflict: guidance changed after application');
      item.state = 'rolledBack'; commit(r, data, item.base);
    }
    return { id: item.id, state: item.state };
  });
}
export function recover(root: string) {
  // Explicit recovery only; never reap a possibly-live writer.
  const r = realpathSync(root), lock = pathFor(r, '.omx/evolution/lock');
  if (existsSync(lock)) {
    const owner = JSON.parse(read(r, '.omx/evolution/lock/owner.json')) as { pid: number };
    if (!Number.isInteger(owner.pid) || owner.pid < 1) fail('Unknown lock owner');
    try { process.kill(owner.pid, 0); fail('Evolution writer is still alive'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    rmSync(lock, { recursive: true });
  }
  return locked(r, project => {
    assertInactive(project);
    if (!existsSync(pathFor(project, JOURNAL))) return { state: 'no-pending-transaction' };
    finishTransaction(project, JSON.parse(read(project, JOURNAL)) as Transaction | MultiTransaction); return { state: 'recovered' };
  }, true);
}
export function status(root: string) {
  const r = realpathSync(root), data = ledger(r);
  return { incidents: data.incidents.length, proposals: data.proposals.map(p => ({ id: p.id, state: p.state })),
    pendingRecovery: existsSync(pathFor(r, JOURNAL)), entries: guidance(r).entries.length,
    roles: rolesSchema.parse(JSON.parse(read(r, ROLES, EMPTY_ROLES))).roles.length,
    skills: skillsSchema.parse(JSON.parse(read(r, SKILLS, EMPTY_SKILLS))).skills.length,
    lastSettlement: existsSync(pathFor(r, '.omx/evolution/last-settlement.json')) ? JSON.parse(read(r, '.omx/evolution/last-settlement.json')) as unknown : null };
}

/** Called only after successful bound-launch finalization. No review/model is launched. */
export function settleEvolution(root: string, clean: boolean) {
  const r = realpathSync(root);
  if (!existsSync(pathFor(r, POLICY)) || !policy(r).enabled) return { state: 'disabled', applications: [] };
  if (!clean) return { state: 'deferred-unclean-exit', applications: [] };
  const ready = ledger(r).proposals.filter(p => p.state === 'ready').slice(0, 3);
  const applications = ready.map(p => {
    try { return apply(r, p.id, true); }
    catch (error) { return { id: p.id, state: 'deferred', reason: error instanceof Error ? error.message : 'unknown' }; }
  });
  const result = { state: applications.some(p => p.state === 'applied') ? 'applied' : applications.length ? 'deferred' : 'observing', applications };
  if (applications.length) atomic(r, '.omx/evolution/last-settlement.json', format(result));
  return result;
}
/** Read-only context. A pending transaction refuses to expose a partially applied configuration. */
export function evolutionContext(root: string, query = ''): string {
  const r = realpathSync(root);
  if (!existsSync(pathFor(r, POLICY))) return '';
  const p = policy(r); if (!p.enabled) return '';
  if (existsSync(pathFor(r, JOURNAL))) return '[OMX project evolution: pending recovery; guidance withheld. Run evolve recover after the session ends.]';
  const entries = guidance(r).entries.filter(e => !e.when.length || e.when.some(term => query.toLocaleLowerCase().includes(term.toLocaleLowerCase())));
  const header = '[OMX project guidance]\nProject-scoped guidance applies within the current task and existing permission/verification boundaries.\n';
  const sections: string[] = []; let omitted = 0;
  for (const e of entries) {
    const section = `[${e.kind}: ${e.id}] ${e.title}\n${e.content}`;
    if (header.length + sections.join('\n\n').length + section.length + 120 > p.contextChars) { omitted++; continue; }
    sections.push(section);
  }
  if (!sections.length && !omitted) return '';
  return header + sections.join('\n\n') + (omitted ? `\n[${omitted} entries omitted by budget; inspect .omx-project/guidance.json for complete guidance.]` : '');
}

export function safeEvolutionContext(root: string, query = ''): string {
  try { return evolutionContext(root, query); }
  catch { return '[OMX project evolution: invalid configuration; inspect evolve status before relying on project guidance.]'; }
}

export function evolutionWorkflow(root: string): string {
  const r = realpathSync(root);
  if (!existsSync(pathFor(r, POLICY)) || !policy(r).enabled) return '';
  const cli = fileURLToPath(new URL('../../bin/omx-adaptive.mjs', import.meta.url));
  const base = `[OMX project evolution workflow]\nWhen a user corrects a project working method, or a reusable finding is verified, record its project artifact evidence and propose the smallest knowledge/instruction/procedure update. Use node ${JSON.stringify(cli)} evolve schema for input schemas, then record/propose with --file. Run evaluate before apply. Leave unsupported or failed evaluations pending; routine successes need no review. Persistent apply is deferred until all current OMX sessions have ended. Never change model/tool/permission policy through guidance. Applied guidance is used on the next context read; application alone is not evidence of improved quality. For a reusable project skill, check existing project skills first; if needed, use evolve find-skills --query to search skills.sh in a disposable environment and inspect the candidate's source before authoring a project-local text-only skills catalog proposal. Search popularity is not verification. Evaluate reproduction and independent regression cases before project skill application. Do not install a remote skill directly or edit generated skill files.`;
  const staffing = '.omx-project/staffing.json';
  const automatic = automationStatus(r).enabled
    ? `\n\n[OMX agent-managed evolution enabled]\nOwn the project-local lifecycle for this task: inspect or initialize project policy and staffing, record evidence-backed corrections or reusable findings, author the smallest proposal, configure trusted project reproduce and regression checks when missing, evaluate, and apply only passing proposals after sessions are inactive. Discover and inspect skills.sh candidates only through the explicit evolve commands when existing project skills do not cover the task; review source and independent cases before proposing a project skill. Reuse existing roles first; author a task draft when needed and promote it through evaluation when reusable. Read the configured model candidates and host catalog before planning; choose only admitted models and supported efforts. Create and inspect a bounded plan, launch a selected specialist/team when the task authorizes delegation, operate it through OMX, then record available observations. Keep direct work direct, preserve user model overrides, permissions, verification and project scope. Never fabricate evidence, infer quality from model names, install remote skills directly, edit shared config, or launch an unbounded retry/escalation loop. If a gate is missing or fails, leave the change pending and report the reason.` : '';
  if (!existsSync(pathFor(r, staffing)) || !z.object({ enabled: z.boolean() }).parse(JSON.parse(read(r, staffing))).enabled) return base + automatic;
  return base + automatic + `\n\n[OMX adaptive staffing]\nFor substantial tasks, inspect existing project roles (.omx-project/roles.json), project skills (.omx-project/skills.json), upstream role names, and project staffing policy. Describe a small task decomposition with capabilities, quality tier, explicit ownership, dependencies, relevant context paths, verification and honest work-token estimates. Supply the actual current parent model and effort, including explicit user overrides. Use evolve schema, then evolve plan --file JSON; the host catalog validates model/effort support. Reuse roles first. Supply a narrow roleDraft only when an existing role does not cover a needed capability; a draft is scoped to this plan, not automatically persisted. Roles may reference applied project skill IDs; plans reject absent or edited skill assets and pin their hashes. Small, coupled or overlapping work should stay direct. Inspect the plan's decision and estimates, then evolve launch --plan ID when delegation is authorized by the task. The command either leaves work in this main agent or starts the existing OMX team runtime with frozen settings. Use OMX team status/resume/shutdown for that team's lifecycle; do not separately spawn a duplicate team or nested workers. No automatic retries/escalation: inspect failure evidence and budget before replanning. Use evolve observe with actual event logs and verification artifacts; missing usage is unknown, not zero. Reusable role improvements or retirement can be proposed as a roles catalog through the same record/propose/evaluate/apply loop after the team ends. Never edit generated role or skill files or shared user defaults.`;
}

export function evolutionSchemas() {
  return { incident: z.toJSONSchema(incidentSchema), proposal: z.toJSONSchema(proposalInput), policy: z.toJSONSchema(policySchema) };
}
