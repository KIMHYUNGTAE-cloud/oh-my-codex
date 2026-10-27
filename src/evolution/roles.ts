/** Project-owned role definitions. This compiler never installs or launches agents. */
import TOML from '@iarna/toml';
import { z } from 'zod';

export const roleId = z.string().regex(/^[a-z][a-z0-9-]{0,59}$/);
export const effortSchema = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
export const tierSchema = z.enum(['economy', 'balanced', 'deep']);
const line = z.string().trim().min(1).max(1200);
const tags = z.array(roleId).min(1).max(16);
export const roleSchema = z.object({
  id: roleId,
  purpose: line,
  activation: z.array(line).min(1).max(8),
  capabilities: tags,
  skills: z.array(roleId).max(8).optional(),
  inputs: z.array(line).min(1).max(12),
  outputs: z.array(line).min(1).max(12),
  instructions: z.string().trim().min(1).max(8000),
  verification: z.array(line).min(1).max(12),
  modelTier: tierSchema,
  // These are scope contracts, not a replacement for the parent's permission policy.
  scope: z.enum(['read-only', 'workspace-write']),
}).strict();
export const rolesSchema = z.object({ schemaVersion: z.literal(1), roles: z.array(roleSchema).max(40) }).strict()
  .refine(value => new Set(value.roles.map(role => role.id)).size === value.roles.length, 'Duplicate role IDs');
export type ProjectRole = z.infer<typeof roleSchema>;
export type RoleCatalog = z.infer<typeof rolesSchema>;
export const ROLES = '.omx-project/roles.json';
export const EMPTY_ROLES = JSON.stringify({ schemaVersion: 1, roles: [] }, null, 2) + '\n';

export function roleInstructions(role: ProjectRole): string {
  return [
    `# ${role.id}\n${role.purpose}`,
    `Activation:\n${role.activation.map(item => `- ${item}`).join('\n')}`,
    `Inputs:\n${role.inputs.map(item => `- ${item}`).join('\n')}`,
    `Outputs:\n${role.outputs.map(item => `- ${item}`).join('\n')}`,
    ...(role.skills?.length ? [`Project skills:\n${role.skills.map(id => `- adaptive-${id}: .agents/skills/adaptive-${id}/SKILL.md`).join('\n')}\nRead a listed skill when its activation conditions match the assigned task.`] : []),
    role.instructions,
    `Verification:\n${role.verification.map(item => `- ${item}`).join('\n')}`,
    `Scope: ${role.scope}. Remain within the assigned files and the parent's permissions.`,
    'Leaf role: do not spawn other agents. Return concise evidence, changed paths, checks and unresolved issues. Do not repeat the whole project history.',
  ].join('\n\n') + '\n';
}

/** A reserved filename prefix prevents collisions with upstream role assets. */
export function compileRoles(value: unknown): Map<string, string> {
  const catalog = rolesSchema.parse(value);
  const files = new Map<string, string>();
  const roles = [...catalog.roles].sort((a, b) => a.id.localeCompare(b.id));
  files.set(ROLES, JSON.stringify({ schemaVersion: 1, roles }, null, 2) + '\n');
  for (const role of roles) {
    const name = `adaptive-${role.id}`;
    const instructions = roleInstructions(role);
    // Model/effort are deliberately resolved per run, never baked from user defaults.
    files.set(`.codex/agents/${name}.toml`, '# OMX Adaptive generated role; source: .omx-project/roles.json\n' + TOML.stringify({
      name, description: role.purpose, developer_instructions: instructions,
    }));
    files.set(`.codex/prompts/${name}.md`, instructions);
  }
  return files;
}

export function isRoleArtifact(path: string): boolean {
  return path === ROLES || /^\.codex\/(?:agents\/adaptive-[a-z][a-z0-9-]{0,59}\.toml|prompts\/adaptive-[a-z][a-z0-9-]{0,59}\.md)$/.test(path);
}
