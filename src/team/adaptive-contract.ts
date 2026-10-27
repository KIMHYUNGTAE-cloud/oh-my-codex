/** Optional immutable inputs to the existing team owner, not another runtime. */
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { normalizeTeamWorkerLaunchArgs, parseTeamWorkerLaunchArgs } from './model-contract.js';

const specSchema = z.object({ workerName: z.string().regex(/^worker-[1-8]$/),
  role: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/), model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,149}$/),
  effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']),
  instructions: z.string().min(1).max(120000),
}).strict();
export type AdaptiveWorkerLaunchSpec = z.infer<typeof specSchema>;
const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
export const adaptiveCliCommand = `${shellQuote(process.execPath)} ${shellQuote(fileURLToPath(new URL('../cli/omx.js', import.meta.url)))}`;
export const adaptiveCliBinding = `Runtime CLI binding: execute every OMX worker protocol command using ${adaptiveCliCommand}, even when a skill shows bare omx. This absolute path selects this fork; do not discover another omx on PATH.`;
export function bindAdaptiveCli(text: string): string { return text.replace(/\bomx (?=team\b)/g, `${adaptiveCliCommand} `); }
export function adaptiveTaskIdMap(tasks: readonly { symbolic_id?: string }[], created: readonly { id: string }[]): Record<string, string> {
  if (tasks.length !== created.length) throw new Error('Adaptive task materialization count mismatch');
  return Object.fromEntries(tasks.flatMap((task, index) => task.symbolic_id ? [[task.symbolic_id, created[index]!.id]] : []));
}
export function validateAdaptiveWorkers(value: unknown, count: number): readonly Readonly<AdaptiveWorkerLaunchSpec>[] {
  const specs = z.array(specSchema).min(1).max(8).parse(value);
  if (specs.length !== count || specs.some((s, i) => s.workerName !== `worker-${i + 1}`)) throw new Error('Adaptive worker plan does not match worker count/order');
  return Object.freeze(specs.map(s => Object.freeze(s)));
}
export function pinAdaptiveLaunchArgs(args: string[], spec: Readonly<AdaptiveWorkerLaunchSpec>): string[] {
  specSchema.parse(spec);
  if (parseTeamWorkerLaunchArgs(args).endOfOptionsIndex !== null) throw new Error('Adaptive workers do not accept positional launch arguments');
  // Normalization retains the upstream sandbox/approval policy and other flags.
  // Pin both model axes after inherited/env settings; disable nested delegation.
  return normalizeTeamWorkerLaunchArgs([...args, '-c', `model_reasoning_effort=${JSON.stringify(spec.effort)}`,
    '-c', 'agents.enabled=false'], spec.model, undefined, 'model_provider="openai"');
}
