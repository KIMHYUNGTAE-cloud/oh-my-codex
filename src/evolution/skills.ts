/** Project-owned skills with bounded text sources and scripts. Compilation never executes sources. */
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { z } from 'zod';

export const SKILLS = '.omx-project/skills.json';
export const EMPTY_SKILLS = JSON.stringify({ schemaVersion: 1, skills: [] }, null, 2) + '\n';
const id = z.string().regex(/^[a-z][a-z0-9-]{0,54}$/);
const line = z.string().trim().min(1).max(1200).refine(value => !/[\r\n\0]/.test(value), 'Expected one line');
const text = z.string().min(1).max(16000).refine(value => value.trim().length > 0 && !value.includes('\0'), 'Expected nonempty text without NUL');
const referencePath = z.string().max(160).refine(value =>
  /^(?:(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:md|txt|json|yaml|yml|csv)|scripts\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:sh|py|js|mjs|ts))$/.test(value)
  && value !== 'SKILL.md', 'Expected a relative supporting text path');
const sourceSchema = z.object({
  content: text,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.record(referencePath, text).default({}).refine(value => Object.keys(value).length <= 3, 'At most three supporting files'),
}).strict();
export type SkillSource = { content: string; files?: Record<string, string> };
/** Hash source bytes and sorted supporting paths/content, independent of object insertion order. */
export function skillSourceDigest(source: SkillSource): string {
  return createHash('sha256').update(JSON.stringify({ content: source.content,
    files: Object.entries(source.files ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
  })).digest('hex');
}

function sourceBody(content: string): string {
  if (!content.startsWith('---')) return content.trim();
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(content);
  if (!match) throw new Error('Malformed skill frontmatter');
  const seen = new Set<string>();
  for (const entry of match[1]!.split(/\r?\n/)) {
    const field = /^(name|description):\s*(.+)$/.exec(entry);
    if (!field || seen.has(field[1]!) || /^[>|&*!{[]/.test(field[2]!)) throw new Error('Malformed skill frontmatter: only scalar name and description allowed');
    const scalar = field[2]!.trim();
    if (scalar.startsWith('"')) {
      try { if (typeof JSON.parse(scalar) !== 'string') throw new Error(); }
      catch { throw new Error('Malformed skill frontmatter scalar'); }
    } else if (scalar.startsWith("'") && !/^'(?:[^']|'')*'$/.test(scalar)) {
      throw new Error('Malformed skill frontmatter scalar');
    }
    seen.add(field[1]!);
  }
  if (!seen.has('name') || !seen.has('description')) throw new Error('Malformed skill frontmatter: name and description required');
  if (!match[2]!.trim()) throw new Error('Skill body is empty');
  return match[2]!.trim();
}

function validateReferences(source: SkillSource): void {
  const files = source.files ?? {};
  for (const [path, content] of [['SKILL.md', source.content], ...Object.entries(files)]) {
    for (const match of content!.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
      const target = match[1]!;
      if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
      if (target.includes('\\') || target.includes('%') || target.startsWith('/') || target.includes(':')) throw new Error(`Unsafe reference: ${target}`);
      const relative = target.split('#')[0]!;
      const resolved = posix.normalize(posix.join(posix.dirname(path!), relative));
      if (resolved.startsWith('../') || (resolved !== 'SKILL.md' && !Object.hasOwn(files, resolved))) throw new Error(`Missing or unsafe reference: ${target}`);
    }
    // Reference-style links have hidden targets: reject rather than silently skip validation.
    if (/^\s*\[[^\]]+\]:/m.test(content!)) throw new Error('Use inline links for skill references');
  }
}

export const skillSchema = z.object({
  id,
  purpose: line,
  activation: z.array(line).min(1).max(8),
  compatibility: z.object({ runtimes: z.tuple([z.literal('codex')]), scope: z.literal('project') }).strict(),
  dependencies: z.array(id).max(16).refine(items => new Set(items).size === items.length, 'Duplicate dependencies'),
  provenance: z.object({ kind: z.enum(['project', 'sourced']), origin: line, revision: line.optional() }).strict(),
  source: sourceSchema,
}).strict().refine(skill => `${skill.purpose} Use when: ${skill.activation.join('; ')}`.length <= 1024,
  'Generated skill description exceeds 1024 characters');
export const skillsSchema = z.object({ schemaVersion: z.literal(1), skills: z.array(skillSchema).max(40) }).strict()
  .superRefine((catalog, context) => {
    const byId = new Map(catalog.skills.map(skill => [skill.id, skill]));
    const error = (message: string) => context.addIssue({ code: 'custom', message });
    if (byId.size !== catalog.skills.length) error('Duplicate skill IDs');
    for (const skill of catalog.skills) {
      if (skill.source.digest !== skillSourceDigest(skill.source)) error(`Source digest mismatch: ${skill.id}`);
      try { sourceBody(skill.source.content); validateReferences(skill.source); }
      catch (cause) { error(`${skill.id}: ${(cause as Error).message}`); }
      for (const dependency of skill.dependencies) if (!byId.has(dependency)) error(`Missing skill dependency: ${dependency}`);
    }
    const active = new Set<string>();
    const done = new Set<string>();
    const visit = (name: string): void => {
      if (active.has(name)) { error(`Cyclic skill dependency: ${name}`); return; }
      if (done.has(name)) return;
      active.add(name);
      for (const dependency of byId.get(name)?.dependencies ?? []) visit(dependency);
      active.delete(name); done.add(name);
    };
    for (const name of byId.keys()) visit(name);
  });
export type ProjectSkill = z.infer<typeof skillSchema>;
export type SkillCatalog = z.infer<typeof skillsSchema>;

export function compileSkills(value: unknown): Map<string, string> {
  const catalog = skillsSchema.parse(value);
  const skills = [...catalog.skills].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(skill => ({ ...skill,
    dependencies: [...skill.dependencies].sort(),
    source: { ...skill.source, files: Object.fromEntries(Object.entries(skill.source.files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) },
  }));
  const result = new Map<string, string>([[SKILLS, JSON.stringify({ schemaVersion: 1, skills }, null, 2) + '\n']]);
  for (const skill of skills) {
    const root = `.agents/skills/adaptive-${skill.id}`;
    const description = `${skill.purpose} Use when: ${skill.activation.join('; ')}`;
    result.set(`${root}/SKILL.md`, `---\nname: adaptive-${skill.id}\ndescription: ${JSON.stringify(description)}\n---\n\n${sourceBody(skill.source.content)}\n\nRelative links above resolve from this SKILL.md directory. From the project root, prefix linked paths with \`${root}/\`.\nRemain within project scope and the parent agent's permissions.\n`
      + (skill.dependencies.length ? `\nRequires project skills: ${skill.dependencies.map(item => `adaptive-${item}`).join(', ')}.\n` : ''));
    for (const [path, content] of Object.entries(skill.source.files)) result.set(`${root}/${path}`, content);
  }
  return result;
}

export function isSkillArtifact(path: string): boolean {
  if (path === SKILLS) return true;
  const match = /^\.agents\/skills\/adaptive-[a-z][a-z0-9-]{0,54}\/(.+)$/.exec(path);
  return !!match && (match[1] === 'SKILL.md' || referencePath.safeParse(match[1]).success);
}
