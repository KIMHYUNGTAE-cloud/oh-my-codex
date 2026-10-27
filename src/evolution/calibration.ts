/** Conservative reuse of verified observations: never lower a budget estimate from one success. */
import { existsSync, readdirSync } from 'node:fs';
import { z } from 'zod';
import { digest, pathFor, read } from './service.js';
import { parentSchema } from './host.js';

const artifact = z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
const reportSchema = z.object({ modelMismatch: z.literal(false),
  verification: z.array(artifact.extend({ passed: z.literal(true) })).min(1),
  workers: z.array(z.object({ requested: parentSchema, observedModels: z.array(z.string()), observedEfforts: z.array(z.string()), complete: z.literal(true),
    inputTokensPerCall: z.number().int().positive(), artifact,
  })),
});
export interface CalibrationEvidence { path: string; sha256: string; model: string; effort: string; inputTokensPerCall: number; }
export function readCalibration(root: string): CalibrationEvidence[] {
  const dir = '.omx/evolution/observations';
  if (!existsSync(pathFor(root, dir))) return [];
  const evidence: CalibrationEvidence[] = [];
  // Bound work. A deterministic selection, never an unbounded transcript scan.
  for (const name of readdirSync(pathFor(root, dir)).filter(n => /^[a-z0-9-]+\.json$/.test(n)).sort().slice(-100)) {
    const path = `${dir}/${name}`;
    try {
      const content = read(root, path), parsed = reportSchema.safeParse(JSON.parse(content));
      if (!parsed.success) continue;
      if (parsed.data.verification.some(a => digest(read(root, a.path)) !== a.sha256)) continue;
      for (const worker of parsed.data.workers) {
        if (worker.observedModels.length !== 1 || worker.observedModels[0] !== worker.requested.model
          || worker.observedEfforts.length !== 1 || worker.observedEfforts[0] !== worker.requested.effort
          || digest(read(root, worker.artifact.path)) !== worker.artifact.sha256) continue;
        evidence.push({ path, sha256: digest(content), model: worker.requested.model, effort: worker.requested.effort, inputTokensPerCall: worker.inputTokensPerCall });
      }
    } catch { /* Invalid or expired observation is not calibration evidence. */ }
  }
  return evidence;
}
