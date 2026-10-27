import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSkills, skillsSchema, skillSourceDigest, isSkillArtifact, SKILLS, EMPTY_SKILLS } from '../skills.js';

function skill(id = 'review', content = '# Review\nRead the patch and verify findings.', files: Record<string, string> = {}) {
  const source = { content, files };
  return { id, purpose: 'Review project patches.', activation: ['The user requests a patch review.'],
    compatibility: { runtimes: ['codex'], scope: 'project' }, dependencies: [] as string[],
    provenance: { kind: 'project', origin: 'Project maintainers' },
    source: { ...source, digest: skillSourceDigest(source) } };
}
function catalog(...skills: ReturnType<typeof skill>[]) { return { schemaVersion: 1, skills }; }

test('compiles deterministic project-local text artifacts and preserves source provenance', () => {
  const a = skill('review', '# Review\nRead [criteria](references/criteria.md).', { 'references/criteria.md': 'Require evidence.' });
  const b = skill('verify');
  a.dependencies = ['verify'];
  const first = compileSkills(catalog(a, b));
  assert.deepEqual([...first], [...compileSkills(catalog(b, a))]);
  assert.deepEqual([...compileSkills(JSON.parse(first.get(SKILLS)!))], [...first]);
  const rendered = first.get('.agents/skills/adaptive-review/SKILL.md')!;
  assert.match(rendered, /^---\nname: adaptive-review\ndescription: /);
  assert.match(rendered, /The user requests a patch review/);
  assert.match(rendered, /Requires project skills: adaptive-verify/);
  assert.equal(first.get('.agents/skills/adaptive-review/references/criteria.md'), 'Require evidence.');
  assert.deepEqual([...compileSkills(JSON.parse(EMPTY_SKILLS))].map(([path]) => path), [SKILLS]);
});

test('accepts validated sourced frontmatter and replaces metadata with manifest activation', () => {
  const item = skill('review', '---\nname: original\ndescription: Original purpose\n---\n\nPerform the review.');
  item.provenance = { kind: 'sourced', origin: 'https://example.org/skills/review' };
  const result = compileSkills(catalog(item)).get('.agents/skills/adaptive-review/SKILL.md')!;
  assert.match(result, /Perform the review/);
  assert.doesNotMatch(result, /name: original/);
});

test('rejects malformed frontmatter, empty activation and unsupported compatibility', () => {
  for (const content of ['---\nname: bad', '---\nname: a\n---\nBody', '---\nname: a\ndescription: b\nrun: shell\n---\nBody', '---\nname: a\ndescription: |\n  multiline\n---\nBody']) {
    assert.throws(() => compileSkills(catalog(skill('review', content))), /frontmatter/);
  }
  const item = skill();
  assert.equal(skillsSchema.safeParse(catalog({ ...item, activation: [] })).success, false);
  assert.equal(skillsSchema.safeParse(catalog({ ...item, compatibility: { runtimes: ['other'], scope: 'project' } })).success, false);
  assert.equal(skillsSchema.safeParse({ schemaVersion: 1, skills: [{ ...item, install: 'run shell' }] }).success, false);
  assert.equal(skillsSchema.safeParse(catalog(skill('a'.repeat(56)))).success, false);
  assert.equal(skillsSchema.safeParse(catalog({ ...item, activation: ['x'.repeat(1100)] })).success, false);
});

test('rejects missing or cyclic dependencies and duplicate IDs', () => {
  const a = skill('review'); a.dependencies = ['missing'];
  assert.throws(() => compileSkills(catalog(a)), /Missing skill dependency/);
  const b = skill('verify'); a.dependencies = ['verify']; b.dependencies = ['review'];
  assert.throws(() => compileSkills(catalog(a, b)), /Cyclic/);
  assert.throws(() => compileSkills(catalog(skill(), skill())), /Duplicate skill IDs/);
});

test('rejects source tampering, missing references and unsafe support files', () => {
  const item = skill(); item.source.content += 'tampered';
  assert.throws(() => compileSkills(catalog(item)), /digest mismatch/);
  for (const target of ['missing.md', '../secret.md', '/secret.md', 'file:///secret', '%2e%2e/secret.md']) {
    assert.throws(() => compileSkills(catalog(skill('review', `Read [reference](${target}).`))), /reference/i);
  }
  for (const path of ['../outside.md', '/absolute.md', 'scripts/run.exe', 'run.sh', 'a\\b.md', 'SKILL.md']) {
    assert.equal(skillsSchema.safeParse(catalog(skill('review', 'Body', { [path]: 'text' }))).success, false);
  }
  assert.throws(() => compileSkills(catalog(skill('review', '[hidden]: missing.md\nRead [hidden].'))), /inline links/);
});

test('nested support references resolve within the embedded skill tree; artifact guard is bounded', () => {
  compileSkills(catalog(skill('review', '[guide](refs/guide.md)', {
    'refs/guide.md': '[Details](../details.txt)', 'details.txt': 'Details',
  })));
  assert.equal(isSkillArtifact(SKILLS), true);
  assert.equal(isSkillArtifact('.agents/skills/adaptive-review/refs/guide.md'), true);
  assert.equal(isSkillArtifact('.agents/skills/adaptive-review/scripts/check.py'), true);
  for (const path of ['.agents/skills/upstream/SKILL.md', '.agents/skills/adaptive-review/../outside.md', '.agents/skills/adaptive-review/install.sh', '/.agents/skills/adaptive-review/SKILL.md']) assert.equal(isSkillArtifact(path), false);
});

test('allows reviewed project scripts as pinned assets without running them during compilation', () => {
  const script = 'print("checked")\n';
  const files = compileSkills(catalog(skill('review', 'Run [the check](scripts/check.py) for project schema changes.', { 'scripts/check.py': script })));
  assert.equal(files.get('.agents/skills/adaptive-review/scripts/check.py'), script);
});
