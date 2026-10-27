import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { discoverSkills, inspectSkill, parseSkillsCliFind } from '../skill-discovery.js';

const skill = { id: 'acme/skills/reviewer', slug: 'reviewer', name: 'Reviewer', source: 'acme/skills', installs: 12,
  installUrl: 'https://github.com/acme/skills', url: 'https://skills.sh/acme/skills/reviewer' };
const files = [{ path: 'SKILL.md', contents: '---\nname: Reviewer\n---\nReview code.' }, { path: 'notes.md', contents: 'Check tests.' }];
function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('discovery returns metadata with source URLs and hashes without importing content', async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input); calls.push(url);
    return url.includes('/search?') ? response({ data: [skill] }) : response({ id: skill.id, hash: 'a'.repeat(64), files });
  };
  const result = await discoverSkills('code review', { fetch: fetcher });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]!.provenance.platformHash, 'a'.repeat(64));
  assert.equal(result.candidates[0]!.provenance.fileCount, 2);
  assert.match(result.candidates[0]!.provenance.contentSha256!, /^[a-f0-9]{64}$/);
  assert.equal(calls.length, 2);
  assert.equal(result.searchPageUrl, 'https://skills.sh/search?q=code%20review');
});

test('unauthenticated search gives a useful public-page fallback and never invokes the CLI', async () => {
  let calls = 0;
  const result = await discoverSkills('typescript', { fetch: async () => { calls++; return response({ error: 'authentication_required' }, 401); } });
  assert.equal(calls, 1);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.searchPageUrl, 'https://skills.sh/search?q=typescript');
  assert.match(result.notice!, /requires Vercel OIDC/);
});

test('inspection returns validated read-only text and computed content digest', async () => {
  const inspected = await inspectSkill(skill.id, { fetch: async () => response({ id: skill.id, hash: null, files }) });
  const expected = createHash('sha256').update('notes.md\0Check tests.\0')
    .update('SKILL.md\0---\nname: Reviewer\n---\nReview code.\0').digest('hex');
  assert.deepEqual(inspected.files, [...files].sort((a, b) => a.path.localeCompare(b.path)));
  assert.equal(inspected.contentSha256, expected);
  assert.equal(inspected.platformHash, null);
});

test('inspection reports API auth requirements and rejects unsafe identifiers and paths', async () => {
  const denied = await inspectSkill(skill.id, { fetch: async () => response({}, 401) });
  assert.deepEqual(denied.files, []);
  assert.match(denied.unavailableReason!, /requires Vercel OIDC/);
  await assert.rejects(() => inspectSkill('../../etc/passwd'), /source\/skill identifier/);
  const unsafe = await inspectSkill(skill.id, { fetch: async () => response({ id: skill.id, files: [{ path: '../secret', contents: 'no' }] }) });
  assert.equal(unsafe.contentSha256, null);
  assert.deepEqual(unsafe.files, []);
});

test('query, limit, and timeout bounds are enforced before network access', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return response({ data: [] }); };
  await assert.rejects(() => discoverSkills('x', { fetch: fetcher }), /query must/);
  await assert.rejects(() => discoverSkills('valid', { limit: 21, fetch: fetcher }), /limit must/);
  await assert.rejects(() => discoverSkills('valid', { timeoutMs: 31_000, fetch: fetcher }), /timeoutMs must/);
  assert.equal(calls, 0);
});

test('inspection refuses duplicate snapshot paths', async () => {
  const inspected = await inspectSkill(skill.id, { fetch: async () => response({ id: skill.id, files: [files[0], files[0]] }) });
  assert.equal(inspected.contentSha256, null);
  assert.deepEqual(inspected.files, []);
});

test('official CLI find output becomes reviewable source metadata, not an installation', () => {
  const output = '\x1b[36macme/skills@reviewer 12.3K installs\x1b[0m\n└ https://skills.sh/acme/skills/reviewer\n';
  const found = parseSkillsCliFind('review', output);
  assert.equal(found.candidates.length, 1);
  assert.equal(found.candidates[0]!.id, 'acme/skills/reviewer');
  assert.equal(found.candidates[0]!.installs, 12300);
  assert.equal(found.candidates[0]!.provenance.contentSha256, null);
});
