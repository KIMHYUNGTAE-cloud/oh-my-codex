/** Bounded, deterministic staffing. Semantic task decomposition stays with the current agent. */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AGENT_DEFINITIONS } from '../agents/definitions.js';
import { atomic, digest, locked, pathFor, read } from './service.js';
import { configuredParent, hostSchema, parentSchema, type HostCatalog, type ParentModel } from './host.js';
import { EMPTY_ROLES, ROLES, effortSchema, roleId, roleInstructions, roleSchema, rolesSchema, tierSchema, type ProjectRole } from './roles.js';
import { readCalibration, type CalibrationEvidence } from './calibration.js';
import { compileSkills, EMPTY_SKILLS, SKILLS, skillsSchema } from './skills.js';

const text = z.string().trim().min(1).max(2000);
const filePath = z.string().min(1).max(500).refine(v => !v.startsWith('/') && !v.includes('\\')
  && v.split('/').every(part => part !== '..' && part !== '.' && part !== '')
  && !['.omx', '.git'].includes(v.split('/')[0]!) && !v.includes('\0'), 'Invalid task path');
const profileSchema = z.object({ model: z.string().min(1).max(150),
  effort: z.union([effortSchema, z.literal('inherit'), z.literal('default')]),
  workTokenFactor: z.number().min(0.25).max(4).default(1) }).strict();
const modelCandidateSchema = z.object({
  model: z.string().min(1).max(150), tier: tierSchema,
  efforts: z.array(effortSchema).min(1).max(6),
}).strict();
export const modelCandidatesSchema = z.object({ candidates: z.array(modelCandidateSchema).min(1).max(24) }).strict().refine(value =>
  new Set(value.candidates.map(candidate => candidate.model)).size === value.candidates.length
  && value.candidates.every(candidate => new Set(candidate.efforts).size === candidate.efforts.length),
  'Duplicate model candidate or effort');
export const staffingPolicySchema = z.object({ schemaVersion: z.literal(1), enabled: z.boolean(),
  profiles: z.object({ economy: profileSchema, balanced: profileSchema, deep: profileSchema }).strict(),
  modelCandidates: z.array(modelCandidateSchema).max(24).default([]),
  maxWorkers: z.number().int().min(1).max(8), maxEstimatedTokens: z.number().int().min(1000).max(1000000),
  maxContextChars: z.number().int().min(1000).max(100000),
  delegationTokens: z.number().int().min(0).max(10000), synthesisTokens: z.number().int().min(0).max(20000),
  runtimeInputTokens: z.number().int().min(1000).max(100000).default(16000),
  workerLifecycleTurns: z.number().int().min(1).max(20).default(5),
  leaderCoordinationTurns: z.number().int().min(1).max(10).default(2),
  minSavingsFraction: z.number().min(0).max(0.9), catalogMaxAgeMinutes: z.number().int().min(1).max(1440),
}).strict();
const taskSchema = z.object({ id: roleId, description: text, capabilities: z.array(roleId).min(1).max(16),
  minTier: tierSchema, scope: z.enum(['read-only', 'workspace-write']),
  context: z.array(filePath).max(20), writes: z.array(filePath.refine(v => !['.omx-project', '.codex', '.agents'].includes(v.split('/')[0]!), 'Staffed tasks cannot change their own configuration')).max(20), dependsOn: z.array(roleId).max(8),
  estimatedWorkTokens: z.number().int().min(1).max(200000), outputTokens: z.number().int().min(1).max(4000),
  estimatedTurns: z.number().int().min(1).max(100).optional(),
  verification: z.array(text).min(1).max(8), role: roleId.optional(), model: parentSchema.optional(),
}).strict();
export const planInputSchema = z.object({ id: roleId, goal: text, parent: parentSchema.optional(),
  mode: z.enum(['auto', 'direct', 'specialist', 'team']).default('auto'),
  mainContextTokens: z.number().int().min(0).max(1000000),
  estimatedMainTurns: z.number().int().min(1).max(200).optional(),
  tasks: z.array(taskSchema).min(1).max(8), roleDrafts: z.array(roleSchema).max(8).default([]),
}).strict();
export type StaffingPolicy = z.infer<typeof staffingPolicySchema>;
export type PlanInput = z.infer<typeof planInputSchema>;
type Task = PlanInput['tasks'][number];
export interface WorkerPlan {
  name: string; role: ProjectRole; roleSource: 'project' | 'upstream' | 'task-draft';
  model: ParentModel; modelSource: 'explicit-task' | 'project-tier' | 'inherited-parent';
  taskIds: string[]; instructions: string; estimatedTokens: number;
}
export interface StaffingPlan {
  schemaVersion: 1; id: string; digest: string; project: string; goal: string;
  mode: 'direct' | 'specialist' | 'team'; reason: string; parent: ParentModel;
  policy: StaffingPolicy; host: HostCatalog; tasks: Task[]; workers: WorkerPlan[];
  sourceHashes: Record<string, string>; configurationHashes: Record<string, string | null>;
  estimates: { method: 'repeated-input-plus-declared-work-v2'; direct: number; selected: number;
    candidates: Array<{ mode: string; tokens: number | null; reason: string }> };
  draftRoles: ProjectRole[];
  calibration: CalibrationEvidence[];
}
export const STAFFING_POLICY = '.omx-project/staffing.json';
const tiers = ['economy', 'balanced', 'deep'] as const;
const tokenEstimate = (text: string) => Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
export function initStaffing(root: string) {
  return locked(root, r => {
    if (existsSync(pathFor(r, STAFFING_POLICY))) return { state: 'existing', policy: STAFFING_POLICY };
    const profile = { model: 'inherit', effort: 'inherit' as const, workTokenFactor: 1 };
    const policy: StaffingPolicy = { schemaVersion: 1, enabled: true, profiles: { economy: profile, balanced: profile, deep: profile }, modelCandidates: [],
      maxWorkers: 3, maxEstimatedTokens: 500000, maxContextChars: 24000, delegationTokens: 1200,
      synthesisTokens: 1200, runtimeInputTokens: 16000, workerLifecycleTurns: 5, leaderCoordinationTurns: 2,
      minSavingsFraction: 0.1, catalogMaxAgeMinutes: 30 };
    atomic(r, STAFFING_POLICY, JSON.stringify(policy, null, 2) + '\n');
    return { state: 'initialized', policy: STAFFING_POLICY, modelSelection: 'inherit-until-project-configured' };
  });
}
export function enableStaffing(root: string) {
  return locked(root, r => {
    const policy = staffingPolicySchema.parse(JSON.parse(read(r, STAFFING_POLICY)));
    if (!policy.enabled) atomic(r, STAFFING_POLICY, JSON.stringify({ ...policy, enabled: true }, null, 2) + '\n');
    return { enabled: true, policy: STAFFING_POLICY };
  });
}
export function listModelCandidates(root: string) {
  const r = realpathSync(root);
  const policy = staffingPolicySchema.parse(JSON.parse(read(r, STAFFING_POLICY)));
  return { candidates: policy.modelCandidates };
}
export function setModelCandidates(root: string, value: unknown, catalog: unknown) {
  return locked(root, r => {
    const requested = modelCandidatesSchema.parse(value);
    const host = hostSchema.parse(catalog);
    for (const candidate of requested.candidates) {
      const available = host.models.find(model => model.id === candidate.model);
      if (!available) throw new Error(`Candidate model is absent from host catalog: ${candidate.model}`);
      for (const effort of candidate.efforts) if (!available.efforts.includes(effort))
        throw new Error(`Unsupported candidate effort ${effort} for ${candidate.model}`);
    }
    const policy = staffingPolicySchema.parse(JSON.parse(read(r, STAFFING_POLICY)));
    const next = staffingPolicySchema.parse({ ...policy, modelCandidates: requested.candidates });
    atomic(r, STAFFING_POLICY, JSON.stringify(next, null, 2) + '\n');
    return { candidates: next.modelCandidates };
  });
}
export function clearModelCandidates(root: string) {
  return locked(root, r => {
    const policy = staffingPolicySchema.parse(JSON.parse(read(r, STAFFING_POLICY)));
    atomic(r, STAFFING_POLICY, JSON.stringify({ ...policy, modelCandidates: [] }, null, 2) + '\n');
    return { candidates: [] };
  });
}
export function removeModelCandidate(root: string, model: string) {
  return locked(root, r => {
    const policy = staffingPolicySchema.parse(JSON.parse(read(r, STAFFING_POLICY)));
    const candidates = policy.modelCandidates.filter(candidate => candidate.model !== model);
    if (candidates.length === policy.modelCandidates.length) throw new Error(`Model candidate not configured: ${model}`);
    atomic(r, STAFFING_POLICY, JSON.stringify({ ...policy, modelCandidates: candidates }, null, 2) + '\n');
    return { candidates };
  });
}

function upstreamRoles(): ProjectRole[] {
  // Existing role names are capability tags; arbitrary domain tags require project roles.
  return Object.values(AGENT_DEFINITIONS).filter(d => d.routingRole !== 'leader').flatMap(d => {
    const path = fileURLToPath(new URL(`../../prompts/${d.name}.md`, import.meta.url));
    if (!existsSync(path)) return [];
    return [{ id: d.name, purpose: d.description, activation: [d.description], capabilities: [d.name],
      inputs: ['Assigned task and relevant project context'], outputs: ['Concise result with evidence and unresolved issues'],
      instructions: readFileSync(path, 'utf8'), verification: ['Run the checks specified by the assigned task'],
      modelTier: (d.modelClass === 'fast' ? 'economy' : d.modelClass === 'frontier' ? 'deep' : 'balanced') as ProjectRole['modelTier'],
      scope: (d.tools === 'read-only' || d.tools === 'analysis' ? 'read-only' : 'workspace-write') as ProjectRole['scope'] }];
  });
}
function validateDag(tasks: Task[]): void {
  if (new Set(tasks.map(t => t.id)).size !== tasks.length) throw new Error('Duplicate task IDs');
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw new Error('Task dependency cycle');
    if (visited.has(id)) return;
    const task = tasks.find(t => t.id === id); if (!task) throw new Error('Unknown dependency');
    if (task.scope === 'read-only' && task.writes.length) throw new Error('Read-only task cannot own writes');
    if (task.scope === 'workspace-write' && !task.writes.length) throw new Error('Write task needs explicit ownership paths');
    visiting.add(id); task.dependsOn.forEach(visit); visiting.delete(id); visited.add(id);
  }
  tasks.forEach(t => visit(t.id));
}
function assertModel(host: HostCatalog, model: ParentModel): void {
  const available = host.models.find(m => m.id === model.model);
  if (!available) throw new Error(`Requested model is absent from host catalog: ${model.model}`);
  if (!available.efforts.includes(model.effort)) throw new Error(`Unsupported effort ${model.effort} for ${model.model}`);
}
function resolveModel(task: Task, role: ProjectRole, policy: StaffingPolicy, parent: ParentModel, host: HostCatalog) {
  const tier = tiers[Math.max(tiers.indexOf(task.minTier), tiers.indexOf(role.modelTier))]!;
  const profile = policy.profiles[tier];
  const eligible = policy.modelCandidates.filter(candidate => tiers.indexOf(candidate.tier) >= tiers.indexOf(tier))
    .sort((a, b) => tiers.indexOf(a.tier) - tiers.indexOf(b.tier));
  const inherited = eligible.find(candidate => candidate.model === parent.model && candidate.efforts.includes(parent.effort));
  const choice = profile.model === 'inherit' && policy.modelCandidates.length ? inherited ?? eligible[0] : undefined;
  if (profile.model === 'inherit' && policy.modelCandidates.length && !choice) throw new Error(`No admitted model candidate for ${tier} tier`);
  const model = choice?.model ?? (profile.model === 'inherit' ? parent.model : profile.model);
  const defaultEffort = host.models.find(item => item.id === model)?.defaultEffort;
  let effort = profile.effort === 'inherit' ? parent.effort
    : profile.effort === 'default' ? defaultEffort ?? parent.effort : profile.effort;
  if (choice && !choice.efforts.includes(effort)) {
    if (profile.effort !== 'inherit' && profile.effort !== 'default')
      throw new Error(`Unsupported project profile effort ${effort} for candidate ${model}`);
    effort = defaultEffort && choice.efforts.includes(defaultEffort) ? defaultEffort : choice.efforts[0]!;
  }
  const selected = task.model ?? { model, effort };
  assertModel(host, selected);
  if (policy.modelCandidates.length && !eligible.some(candidate => candidate.model === selected.model && candidate.efforts.includes(selected.effort)))
    throw new Error(`Model ${selected.model}/${selected.effort} is outside project candidates for ${tier} tier`);
  return { model: selected, modelSource: (task.model ? 'explicit-task' : profile.model === 'inherit' && profile.effort === 'inherit'
    && selected.model === parent.model && selected.effort === parent.effort ? 'inherited-parent' : 'project-tier') as WorkerPlan['modelSource'],
    factor: task.model ? 1 : profile.workTokenFactor };
}
const overlaps = (a: string, b: string) => a === b || a.startsWith(b.replace(/\/$/, '') + '/') || b.startsWith(a.replace(/\/$/, '') + '/');

export function createPlan(root: string, value: unknown, catalog: unknown): StaffingPlan {
  return locked(root, r => {
    const input = planInputSchema.parse(value), host = hostSchema.parse(catalog);
    const policy = staffingPolicySchema.parse(JSON.parse(read(r, STAFFING_POLICY)));
    const calibration = readCalibration(r);
    if (!policy.enabled) throw new Error('Adaptive staffing is disabled');
    const age = Date.now() - Date.parse(host.observedAt);
    if (age < -60000 || age > policy.catalogMaxAgeMinutes * 60000) throw new Error('Host catalog is stale; refresh before planning');
    const parent = input.parent ?? configuredParent(r); assertModel(host, parent); validateDag(input.tasks);
    if (new Set(input.roleDrafts.map(d => d.id)).size !== input.roleDrafts.length) throw new Error('Duplicate role drafts');
    const projectRoles = rolesSchema.parse(JSON.parse(read(r, ROLES, EMPTY_ROLES))).roles;
    const projectSkills = skillsSchema.parse(JSON.parse(read(r, SKILLS, EMPTY_SKILLS))).skills;
    const skillById = new Map(projectSkills.map(skill => [skill.id, skill]));
    const skillArtifacts = compileSkills({ schemaVersion: 1, skills: projectSkills });
    const available = [...projectRoles.map(role => ({ role, source: 'project' as const })),
      ...upstreamRoles().filter(role => !projectRoles.some(p => p.id === role.id)).map(role => ({ role, source: 'upstream' as const }))];
    if (input.roleDrafts.some(d => available.some(a => a.role.id === d.id))) throw new Error('Role draft collides with an existing role; use an evaluated role update');
    const sourceHashes: Record<string, string> = {}, context = new Map<string, string>();
    for (const task of input.tasks) for (const path of task.context) {
      if (context.has(path)) continue;
      const content = read(r, path); context.set(path, content); sourceHashes[path] = digest(content);
    }
    const configurationHashes = Object.fromEntries([STAFFING_POLICY, ROLES, SKILLS, '.omx-project/guidance.json', '.omx-project/policy.json', 'AGENTS.md', '.codex/config.toml'].map(path =>
      [path, existsSync(pathFor(r, path)) ? digest(read(r, path)) : null]));
    const mainInput = policy.runtimeInputTokens + input.mainContextTokens + tokenEstimate(input.goal);
    const directContext = [...context.values()].reduce((sum, s) => sum + tokenEstimate(s), 0)
      + input.tasks.reduce((sum, t) => sum + tokenEstimate(t.description), 0);
    const mainTurns = input.estimatedMainTurns ?? input.tasks.reduce((sum, task) => sum + (task.estimatedTurns ?? 4), 0);
    // Total input usage repeats across tool turns, even when much of it is cached.
    // Count leader coordination too: delegation does not erase the main context.
    const direct = (mainInput + directContext) * mainTurns
      + input.tasks.reduce((sum, t) => sum + t.estimatedWorkTokens + t.outputTokens, 0);
    const groups: Array<{ worker: WorkerPlan; tasks: Task[]; factors: number[] }> = [];
    const gaps: string[] = [];
    for (const task of input.tasks) {
      const suitable = (role: ProjectRole) => (!task.role || task.role === role.id)
        && task.capabilities.every(cap => role.capabilities.includes(cap)) && (task.scope === 'read-only' || role.scope === 'workspace-write');
      const existing = available.filter(a => suitable(a.role)).sort((a, b) =>
        (a.source === 'project' ? 0 : 1) - (b.source === 'project' ? 0 : 1)
        || (a.role.scope === task.scope ? 0 : 1) - (b.role.scope === task.scope ? 0 : 1)
        || a.role.instructions.length - b.role.instructions.length || a.role.id.localeCompare(b.role.id))[0];
      const draft = input.roleDrafts.filter(suitable).sort((a, b) => a.instructions.length - b.instructions.length || a.id.localeCompare(b.id))[0];
      const selected = existing ?? (draft ? { role: draft, source: 'task-draft' as const } : undefined);
      if (!selected) { gaps.push(task.id); continue; }
      const required = new Set<string>();
      const visitSkill = (id: string): void => {
        if (required.has(id)) return;
        const skill = skillById.get(id);
        if (!skill) throw new Error(`Role ${selected.role.id} requires missing project skill: ${id}`);
        required.add(id); skill.dependencies.forEach(visitSkill);
      };
      selected.role.skills?.forEach(visitSkill);
      for (const id of required) for (const [path, content] of skillArtifacts) {
        if (!path.startsWith(`.agents/skills/adaptive-${id}/`)) continue;
        const actual = existsSync(pathFor(r, path)) ? read(r, path) : null;
        if (actual !== content) throw new Error(`Project skill artifact missing or changed: ${path}`);
        configurationHashes[path] = digest(content);
      }
      const allocation = resolveModel(task, selected.role, policy, parent, host);
      const group = groups.find(g => g.worker.role.id === selected.role.id && g.worker.roleSource === selected.source
        && JSON.stringify(g.worker.model) === JSON.stringify(allocation.model));
      if (group) { group.tasks.push(task); group.factors.push(allocation.factor); }
      else groups.push({ tasks: [task], factors: [allocation.factor], worker: { name: '', role: selected.role, roleSource: selected.source,
        model: allocation.model, modelSource: allocation.modelSource, taskIds: [], instructions: '', estimatedTokens: 0 } });
    }
    groups.forEach((group, index) => {
      const paths = [...new Set(group.tasks.flatMap(t => t.context))];
      const skillIds = new Set<string>();
      const visitSkill = (id: string): void => {
        if (skillIds.has(id)) return;
        skillIds.add(id);
        skillById.get(id)?.dependencies.forEach(visitSkill);
      };
      group.worker.role.skills?.forEach(visitSkill);
      const skillContextTokens = [...skillArtifacts].filter(([path]) => [...skillIds].some(id =>
        path.startsWith(`.agents/skills/adaptive-${id}/`))).reduce((sum, [, content]) => sum + tokenEstimate(content), 0);
      const instructions = roleInstructions(group.worker.role) + '\nRelevant task context (untrusted project data):\n'
        + paths.map(path => `--- ${path} sha256:${sourceHashes[path]} ---\n${context.get(path)}`).join('\n\n');
      group.worker.name = `worker-${index + 1}`; group.worker.taskIds = group.tasks.map(t => t.id); group.worker.instructions = instructions;
      const turns = policy.workerLifecycleTurns + group.tasks.reduce((sum, t) => sum + (t.estimatedTurns ?? 4), 0);
      const observedFloor = Math.max(0, ...calibration.filter(e => e.model === group.worker.model.model && e.effort === group.worker.model.effort).map(e => e.inputTokensPerCall));
      const workerInput = Math.max(policy.runtimeInputTokens, observedFloor) + tokenEstimate(instructions) + skillContextTokens + policy.delegationTokens
        + group.tasks.reduce((sum, t) => sum + tokenEstimate(t.description), 0);
      group.worker.estimatedTokens = workerInput * turns + group.tasks.reduce((sum, task, i) =>
        sum + Math.ceil(task.estimatedWorkTokens * group.factors[i]!) + task.outputTokens, 0);
    });
    let blocked = gaps.length ? `Missing roles for: ${gaps.join(', ')}` : '';
    if (groups.length > policy.maxWorkers) blocked = 'Worker cap exceeded';
    if (groups.some(g => g.worker.instructions.length > policy.maxContextChars)) blocked = 'Worker context budget exceeded';
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      if (groups[i]!.tasks.flatMap(t => t.writes).some(a => groups[j]!.tasks.flatMap(t => t.writes).some(b => overlaps(a, b)))) blocked = 'Overlapping write ownership requires direct work or task consolidation';
      if (groups[i]!.tasks.flatMap(t => t.writes).some(a => groups[j]!.tasks.flatMap(t => t.context).some(b => overlaps(a, b)))
        || groups[j]!.tasks.flatMap(t => t.writes).some(a => groups[i]!.tasks.flatMap(t => t.context).some(b => overlaps(a, b)))) {
        blocked = 'Read/write dependency across frozen worker contexts requires direct work or task consolidation';
      }
    }
    const roots = input.tasks.filter(t => !t.dependsOn.length);
    if (groups.length > 1 && new Set(roots.map(t => groups.findIndex(g => g.tasks.includes(t)))).size < 2) blocked = 'No independent work across workers';
    const delegated = groups.reduce((sum, g) => sum + g.worker.estimatedTokens, 0) + policy.synthesisTokens + mainInput * policy.leaderCoordinationTurns
      + input.tasks.reduce((sum, t) => sum + t.outputTokens, 0);
    const delegatedMode = groups.length === 1 ? 'specialist' : 'team';
    const candidates = [{ mode: 'direct', tokens: direct, reason: 'Keep current main context; no delegation overhead' },
      { mode: delegatedMode, tokens: blocked ? null : delegated, reason: blocked || 'Reuse compatible tasks in one worker; include delegation, repeated context and synthesis' }];
    let mode: StaffingPlan['mode'] = 'direct', reason = 'Direct work avoids delegation overhead';
    if (input.mode === 'auto') {
      if (!blocked && groups.length && delegated <= policy.maxEstimatedTokens && delegated <= direct * (1 - policy.minSavingsFraction)) {
        mode = delegatedMode; reason = 'Scoped worker contexts meet the configured estimated-token savings threshold';
      } else if (blocked) reason = blocked;
    } else if (input.mode !== 'direct') {
      if (blocked) throw new Error(blocked);
      if (input.mode !== delegatedMode) throw new Error(`Compatible task consolidation yields ${delegatedMode}, not ${input.mode}`);
      mode = input.mode; reason = 'Explicit task routing request within ownership and budget constraints';
    }
    if (mode === 'direct' && input.tasks.some(t => t.model && JSON.stringify(t.model) !== JSON.stringify(parent))) throw new Error('Direct route cannot satisfy an explicit different task model; request a specialist or split the task');
    const selected = mode === 'direct' ? direct : delegated;
    if (selected > policy.maxEstimatedTokens) throw new Error('Estimated token budget exceeded; reduce context or decompose work');
    const workers = mode === 'direct' ? [] : groups.map(g => g.worker);
    const base = { schemaVersion: 1 as const, id: input.id, project: r, goal: input.goal, mode, reason, parent, policy, host,
      tasks: input.tasks, workers, sourceHashes, configurationHashes,
      estimates: { method: 'repeated-input-plus-declared-work-v2' as const, direct, selected, candidates },
      draftRoles: workers.filter(w => w.roleSource === 'task-draft').map(w => w.role), calibration };
    const plan: StaffingPlan = { ...base, digest: digest(JSON.stringify(base)) };
    const path = `.omx/evolution/plans/${input.id}.json`;
    if (existsSync(pathFor(r, path))) throw new Error('Plan ID already exists; immutable plans cannot be overwritten');
    atomic(r, path, JSON.stringify(plan, null, 2) + '\n'); return plan;
  });
}

export function readPlan(root: string, id: string): StaffingPlan {
  root = realpathSync(root);
  roleId.parse(id);
  const plan = JSON.parse(read(root, `.omx/evolution/plans/${id}.json`)) as StaffingPlan;
  const { digest: expected, ...body } = plan;
  if (digest(JSON.stringify(body)) !== expected || plan.project !== root || plan.id !== id || plan.schemaVersion !== 1) throw new Error('Invalid plan snapshot');
  return plan;
}
export function assertPlanCurrent(root: string, plan: StaffingPlan): void {
  if (existsSync(pathFor(root, '.omx/evolution/transaction.json'))) throw new Error('Pending evolution recovery');
  for (const [path, expected] of Object.entries({ ...plan.configurationHashes, ...plan.sourceHashes })) {
    if ((existsSync(pathFor(root, path)) ? digest(read(root, path)) : null) !== expected) throw new Error(`Plan input changed: ${path}; create a new plan`);
  }
}
