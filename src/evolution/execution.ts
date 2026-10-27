/** Hand plans to OMX. No new worker/session owner or automatic retry loop. */
import { existsSync, realpathSync } from 'node:fs';
import { z } from 'zod';
import { atomic, digest, locked, pathFor, read } from './service.js';
import { assertPlanCurrent, readPlan, type StaffingPlan } from './planner.js';
import { roleId } from './roles.js';
import type { AdaptiveWorkerLaunchSpec } from '../team/adaptive-contract.js';

export function teamInputs(plan: StaffingPlan) {
  const workers: AdaptiveWorkerLaunchSpec[] = plan.workers.map(w => ({ workerName: w.name,
    role: `adaptive-${w.role.id}`, model: w.model.model, effort: w.model.effort, instructions: w.instructions }));
  const tasks = plan.tasks.map(task => ({ subject: task.id, symbolic_id: task.id,
    description: [task.description, `Own only: ${task.writes.join(', ') || 'read-only'}.`,
      `Output budget: about ${task.outputTokens} tokens. Return evidence and unresolved issues.`,
      `Verification: ${task.verification.join('; ')}`].join('\n'),
    owner: plan.workers.find(w => w.taskIds.includes(task.id))?.name,
    role: workers.find(w => w.workerName === plan.workers.find(p => p.taskIds.includes(task.id))?.name)?.role,
    symbolic_depends_on: task.dependsOn, requires_code_change: task.scope === 'workspace-write', filePaths: task.writes,
    delegation: { mode: 'none' as const },
    ...(!task.dependsOn.length && !plan.tasks.some(t => t.dependsOn.includes(task.id))
      ? { coordination: { mode: 'lightweight' as const, activation_reasons: ['adaptive-independent-ownership'], source: 'explicit' as const } } : {}),
  }));
  return { workers, tasks };
}
export async function launchPlan(root: string, id: string) {
  root = realpathSync(root);
  const plan = readPlan(root, id);
  const record = `.omx/evolution/runs/${id}.json`;
  const teamName = `adaptive-${plan.digest.slice(0, 16)}`;
  locked(root, r => {
    assertPlanCurrent(r, plan);
    if (existsSync(pathFor(r, record))) throw new Error('Plan already dispatched or attempted; inspect its OMX team before a new plan');
    atomic(r, record, JSON.stringify({ planDigest: plan.digest, state: plan.mode === 'direct' ? 'direct' : 'launching',
      teamName: plan.mode === 'direct' ? null : teamName, attempts: 1, runtimeOwner: 'omx-team' }, null, 2) + '\n');
  });
  if (plan.mode === 'direct') return { state: 'direct', plan: id, requestedModel: plan.parent,
    instruction: 'Continue these tasks in the current main agent; this command launches no model.', tasks: plan.tasks };
  const { workers, tasks } = teamInputs(plan);
  try {
    const { startTeam } = await import('../team/runtime.js');
    const runtime = await startTeam(teamName, plan.goal, workers[0]!.role, workers.length, tasks, root, { adaptiveWorkers: workers });
    const result = { planDigest: plan.digest, state: 'started', teamName: runtime.teamName, attempts: 1, runtimeOwner: 'omx-team',
      requested: workers.map(({ workerName, model, effort }) => ({ workerName, model, effort })) };
    locked(root, r => atomic(r, record, JSON.stringify(result, null, 2) + '\n'));
    return { ...result, next: 'Use the existing OMX team status/resume/shutdown commands; do not launch the same plan again.' };
  } catch (error) {
    locked(root, r => atomic(r, record, JSON.stringify({ planDigest: plan.digest, state: 'launch-error-inspect-runtime', teamName,
      attempts: 1, runtimeOwner: 'omx-team', error: error instanceof Error ? error.message : 'unknown' }, null, 2) + '\n'));
    throw error;
  }
}

const usageSchema = z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative(),
  cached_input_tokens: z.number().int().nonnegative().optional() }).passthrough();
export function summarizeEvents(content: string) {
  let inputTokens = 0, outputTokens = 0, cachedInputTokens = 0, turns = 0;
  let complete = false, cachedKnown = true;
  let inputTokensPerCall: number | null = null;
  const models = new Set<string>(), efforts = new Set<string>();
  let cumulative: z.infer<typeof usageSchema> | null = null;
  for (const line of content.split('\n').filter(Boolean)) {
    const event = JSON.parse(line) as Record<string, unknown>;
    if (event.type === 'turn.completed') {
      const usage = usageSchema.safeParse(event.usage);
      if (usage.success) { inputTokens += usage.data.input_tokens; outputTokens += usage.data.output_tokens; cachedInputTokens += usage.data.cached_input_tokens ?? 0; cachedKnown &&= usage.data.cached_input_tokens !== undefined; turns++; complete = true; }
    }
    const payload = event.payload as Record<string, unknown> | undefined;
    if ((event.type === 'event_msg' && payload?.type === 'task_started') || event.type === 'turn.started') complete = false;
    if (event.type === 'event_msg' && payload?.type === 'task_complete') complete = true;
    if (event.type === 'session_meta' || event.type === 'turn_context') {
      if (typeof payload?.model === 'string') models.add(payload.model);
      if (typeof payload?.effort === 'string') efforts.add(payload.effort);
      if (typeof payload?.reasoning_effort === 'string') efforts.add(payload.reasoning_effort);
    }
    if (event.type === 'event_msg' && payload?.type === 'token_count') {
      const info = payload.info as Record<string, unknown> | undefined;
      const usage = usageSchema.safeParse(info?.total_token_usage); if (usage.success) cumulative = usage.data;
      const last = usageSchema.safeParse(info?.last_token_usage);
      if (last.success) inputTokensPerCall = Math.max(inputTokensPerCall ?? 0, last.data.input_tokens);
    }
  }
  if (!turns && cumulative) { inputTokens = cumulative.input_tokens; outputTokens = cumulative.output_tokens; cachedInputTokens = cumulative.cached_input_tokens ?? 0; cachedKnown = cumulative.cached_input_tokens !== undefined; }
  return { observedModels: [...models], observedEfforts: [...efforts], complete, inputTokensPerCall,
    usage: turns || cumulative ? { inputTokens, outputTokens, cachedInputTokens: cachedKnown ? cachedInputTokens : null, totalTokens: inputTokens + outputTokens } : null };
}
export const observationSchema = z.object({
  workers: z.array(z.object({ workerName: z.string().regex(/^worker-[1-8]$/), eventLog: z.string().min(1).nullable() }).strict()).max(8),
  leaderEventLog: z.string().min(1).nullable(),
  verification: z.array(z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    passed: z.boolean() }).strict()).min(1).max(20),
  reworkTaskIds: z.array(roleId).max(8),
}).strict();
export function observePlan(root: string, id: string, value: unknown) {
  return locked(root, r => {
    const plan = readPlan(r, id), input = observationSchema.parse(value);
    if (input.workers.length !== plan.workers.length || new Set(input.workers.map(w => w.workerName)).size !== input.workers.length
      || input.workers.some(w => !plan.workers.some(p => p.name === w.workerName))) throw new Error('Observation must account for every planned worker exactly once');
    const paths = [...input.workers.map(w => w.eventLog), input.leaderEventLog].filter((p): p is string => p !== null).map(p => pathFor(r, p));
    if (new Set(paths).size !== paths.length) throw new Error('The same event log cannot be counted twice');
    if (input.reworkTaskIds.some(task => !plan.tasks.some(t => t.id === task))) throw new Error('Unknown rework task');
    const evidence = input.verification.map(e => {
      if (digest(read(r, e.path)) !== e.sha256) throw new Error('Verification evidence changed');
      return e;
    });
    const summarize = (path: string | null) => {
      if (path === null) return { observedModels: [], observedEfforts: [], complete: false, inputTokensPerCall: null, usage: null, artifact: null };
      const content = read(r, path); return { ...summarizeEvents(content), artifact: { path, sha256: digest(content) } };
    };
    const workers = input.workers.map(w => ({ name: w.workerName, requested: plan.workers.find(p => p.name === w.workerName)!.model, ...summarize(w.eventLog) }));
    const leader = { requested: plan.parent, ...summarize(input.leaderEventLog) };
    const all = [...workers, leader], complete = all.every(a => a.usage !== null && a.complete);
    const mismatch = all.some(a => a.observedModels.some(model => model !== a.requested.model) || a.observedEfforts.some(effort => effort !== a.requested.effort));
    const report = { planDigest: plan.digest, workers, leader, verification: evidence, verificationAttribution: 'artifact-backed-reporter-claim',
      reworkTaskIds: input.reworkTaskIds, modelMismatch: mismatch, usageComplete: complete,
      totalTokens: complete ? all.reduce((sum, a) => sum + a.usage!.totalTokens, 0) : null,
      knownTokens: all.reduce((sum, a) => sum + (a.usage?.totalTokens ?? 0), 0),
      budgetExceeded: complete ? all.reduce((sum, a) => sum + a.usage!.totalTokens, 0) > plan.policy.maxEstimatedTokens : null,
      savings: 'not-established', automaticEscalation: false };
    const path = `.omx/evolution/observations/${id}-${digest(JSON.stringify(report)).slice(0, 16)}.json`;
    atomic(r, path, JSON.stringify(report, null, 2) + '\n'); return { ...report, path };
  });
}
