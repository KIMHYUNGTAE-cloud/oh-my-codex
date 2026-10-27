import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync, lstatSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const API_BASE = 'https://skills.sh/api/v1/skills';
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_LIMIT = 20;
const CLI_PACKAGE = 'skills@1.7.4';

export interface SkillCandidate {
  id: string;
  name: string;
  slug: string;
  source: string;
  installs: number;
  installUrl: string | null;
  url: string;
  provenance: {
    provider: 'skills.sh';
    searchUrl: string;
    detailUrl: string;
    retrievedAt: string;
    platformHash: string | null;
    contentSha256: string | null;
    fileCount: number | null;
  };
}

export interface SkillDiscoveryResult {
  query: string;
  retrievedAt: string;
  searchPageUrl: string;
  notice?: string;
  candidates: SkillCandidate[];
}

export interface SkillFile { path: string; contents: string }
export interface SkillInspection {
  id: string;
  retrievedAt: string;
  platformHash: string | null;
  contentSha256: string | null;
  files: SkillFile[];
  unavailableReason?: string;
}

export interface DiscoverSkillsOptions {
  limit?: number;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

interface SearchSkill {
  id: string;
  slug: string;
  name: string;
  source: string;
  installs: number;
  installUrl: string | null;
  url: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSkill(value: unknown): SearchSkill {
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[\w.-]+(?:\/[\w.-]+)+$/.test(value.id) ||
      typeof value.slug !== 'string' || typeof value.name !== 'string' || typeof value.source !== 'string' ||
      !Number.isSafeInteger(value.installs) || (value.installs as number) < 0 ||
      !(value.installUrl === null || typeof value.installUrl === 'string') || typeof value.url !== 'string') {
    throw new Error('skills.sh returned an invalid skill record');
  }
  return value as unknown as SearchSkill;
}

function detailUrl(id: string): string {
  return `${API_BASE}/${id.split('/').map(encodeURIComponent).join('/')}`;
}

function validHash(hash: unknown): string | null {
  return typeof hash === 'string' && /^[a-f\d]{32,128}$/i.test(hash) ? hash : null;
}

async function getJson(fetcher: typeof globalThis.fetch, url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { headers: { accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) {
      const error = new Error(`skills.sh request failed with HTTP ${response.status}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    if (Number(response.headers.get('content-length') ?? 0) > 2_000_000) throw new Error('skills.sh response exceeds 2 MB');
    const body = await response.text();
    if (body.length > 2_000_000) throw new Error('skills.sh response exceeds 2 MB');
    return JSON.parse(body) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function parseId(id: string): string {
  if (!/^[a-z\d][\w.-]*(?:\/[a-z\d][\w.-]*)+$/i.test(id) || id.length > 300 || id.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('id must be a skills.sh source/skill identifier');
  }
  return id;
}

function filesSnapshot(files: unknown): { files: SkillFile[]; hash: string } | null {
  const digest = filesDigest(files);
  if (!digest || !Array.isArray(files)) return null;
  return { files: [...files as SkillFile[]].sort((a, b) => a.path.localeCompare(b.path)), hash: digest.hash };
}

/** Fetches a skill's text snapshot for human review; it does not execute or install any file. */
export async function inspectSkill(id: string, options: Pick<DiscoverSkillsOptions, 'timeoutMs' | 'fetch'> = {}): Promise<SkillInspection> {
  const safeId = parseId(id);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_TIMEOUT_MS) throw new Error(`timeoutMs must be an integer from 100 to ${MAX_TIMEOUT_MS}`);
  const url = detailUrl(safeId);
  const retrievedAt = new Date().toISOString();
  try {
    const detail = await getJson(options.fetch ?? globalThis.fetch, url, timeoutMs);
    if (!isRecord(detail) || detail.id !== safeId) throw new Error('skills.sh returned an invalid skill detail response');
    const snapshot = filesSnapshot(detail.files);
    return { id: safeId, retrievedAt, platformHash: validHash(detail.hash), contentSha256: snapshot?.hash ?? null,
      files: snapshot?.files ?? [], ...(snapshot ? {} : { unavailableReason: 'No valid public file snapshot was returned.' }) };
  } catch (error) {
    if (isRecord(error) && error.status === 401) return { id: safeId, retrievedAt, platformHash: null, contentSha256: null, files: [],
      unavailableReason: 'skills.sh requires Vercel OIDC authentication for API detail access. Open the public skill page and review its linked source repository.' };
    throw error;
  }
}

function filesDigest(files: unknown): { hash: string; count: number } | null {
  if (!Array.isArray(files) || files.length > 500) return null;
  const normalized: Array<{ path: string; contents: string }> = [];
  const paths = new Set<string>();
  for (const file of files) {
    if (!isRecord(file) || typeof file.path !== 'string' || typeof file.contents !== 'string' ||
        file.path.startsWith('/') || file.path.split(/[\\/]/).some(part => part === '..')) return null;
    const path = file.path.replaceAll('\\', '/');
    if (paths.has(path)) return null;
    paths.add(path);
    normalized.push({ path, contents: file.contents });
  }
  normalized.sort((a, b) => a.path.localeCompare(b.path));
  const hash = createHash('sha256');
  for (const file of normalized) hash.update(file.path).update('\0').update(file.contents).update('\0');
  return { hash: hash.digest('hex'), count: normalized.length };
}

/** Read-only metadata and content-hash discovery. It never invokes skills CLI or installs/imports skill files. */
export async function discoverSkills(query: string, options: DiscoverSkillsOptions = {}): Promise<SkillDiscoveryResult> {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2 || normalizedQuery.length > 200) throw new Error('query must contain 2 to 200 characters');
  const limit = options.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new Error(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_TIMEOUT_MS) throw new Error(`timeoutMs must be an integer from 100 to ${MAX_TIMEOUT_MS}`);
  const fetcher = options.fetch ?? globalThis.fetch;
  const searchUrl = new URL(`${API_BASE}/search`);
  searchUrl.searchParams.set('q', normalizedQuery);
  searchUrl.searchParams.set('limit', String(limit));
  const searchPageUrl = `https://skills.sh/search?q=${encodeURIComponent(normalizedQuery)}`;
  let searchPayload: unknown;
  try { searchPayload = await getJson(fetcher, searchUrl.toString(), timeoutMs); }
  catch (error) {
    if (isRecord(error) && error.status === 401) return { query: normalizedQuery, retrievedAt: new Date().toISOString(), searchPageUrl,
      notice: 'skills.sh requires Vercel OIDC authentication for API search. Use the public search page; discovery did not run the skills CLI.', candidates: [] };
    throw error;
  }
  if (!isRecord(searchPayload) || !Array.isArray(searchPayload.data)) throw new Error('skills.sh returned an invalid search response');
  const retrievedAt = new Date().toISOString();
  const candidates: SkillCandidate[] = [];
  for (const item of searchPayload.data.slice(0, limit)) {
    const skill = parseSkill(item);
    const url = detailUrl(skill.id);
    let platformHash: string | null = null;
    let contentSha256: string | null = null;
    let fileCount: number | null = null;
    try {
      const detail = await getJson(fetcher, url, timeoutMs);
      if (isRecord(detail) && detail.id === skill.id) {
        platformHash = validHash(detail.hash);
        const digest = filesDigest(detail.files);
        if (digest) ({ hash: contentSha256, count: fileCount } = digest);
      }
    } catch { /* Keep the search candidate and provenance even when detail is temporarily unavailable. */ }
    candidates.push({ ...skill, provenance: { provider: 'skills.sh', searchUrl: searchUrl.toString(), detailUrl: url,
      retrievedAt, platformHash, contentSha256, fileCount } });
  }
  return { query: normalizedQuery, retrievedAt, searchPageUrl, candidates };
}

/** Explicit, read-only CLI search in a disposable HOME; no skill is installed. */
export function findSkillsWithCli(query: string): SkillDiscoveryResult {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2 || normalizedQuery.length > 200 || normalizedQuery.startsWith('-') || /[\r\n\0]/.test(normalizedQuery)) throw new Error('query must contain 2 to 200 characters on one line');
  const temporary = mkdtempSync(join(tmpdir(), 'omx-skills-find-'));
  try {
    const result = spawnSync('npx', ['--yes', CLI_PACKAGE, 'find', normalizedQuery], {
      cwd: temporary, env: { PATH: process.env.PATH, HOME: temporary, npm_config_cache: join(temporary, 'npm-cache'),
        DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1', CI: '1' }, timeout: 60_000, encoding: 'utf8', maxBuffer: 1_000_000,
    });
    if (result.error || result.status !== 0) throw new Error(`skills.sh CLI search failed: ${result.error?.message ?? result.stderr?.slice(0, 500) ?? result.signal ?? result.status}`);
    return parseSkillsCliFind(normalizedQuery, result.stdout);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

/** Parses the official CLI's human-readable find output; malformed records are omitted. */
export function parseSkillsCliFind(query: string, output: string): SkillDiscoveryResult {
  const retrievedAt = new Date().toISOString();
  const candidates: SkillCandidate[] = [];
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = clean.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1 && candidates.length < MAX_LIMIT; i++) {
    const match = /^([a-z\d_.-]+\/[a-z\d_.-]+)@([a-z\d_.-]+)\s+([\d.]+[KMB]?) installs$/i.exec(lines[i]!.trim());
    if (!match) continue;
    const url = lines[i + 1]!.trim().replace(/^└\s*/, '');
    const expected = `https://skills.sh/${match[1]}/${match[2]}`;
    if (url !== expected) continue;
    const multiplier = match[3]!.endsWith('B') ? 1e9 : match[3]!.endsWith('M') ? 1e6 : match[3]!.endsWith('K') ? 1e3 : 1;
    const installs = Math.round(Number.parseFloat(match[3]!) * multiplier);
    if (!Number.isFinite(installs)) continue;
    const id = `${match[1]}/${match[2]}`;
    candidates.push({ id, name: match[2]!, slug: match[2]!, source: match[1]!, installs,
      installUrl: `https://github.com/${match[1]}`, url,
      provenance: { provider: 'skills.sh', searchUrl: `https://skills.sh/search?q=${encodeURIComponent(query)}`,
        detailUrl: detailUrl(id), retrievedAt, platformHash: null, contentSha256: null, fileCount: null } });
  }
  return { query, retrievedAt, searchPageUrl: `https://skills.sh/search?q=${encodeURIComponent(query)}`,
    ...(candidates.length ? {} : { notice: 'No parseable skills.sh CLI results; inspect the public search page.' }), candidates };
}

/** Downloads a named public skill into a disposable project for inspection only. */
export function inspectSkillWithCli(id: string): SkillInspection {
  const safeId = parseId(id);
  const parts = safeId.split('/');
  if (parts.length !== 3) throw new Error('CLI inspection requires a public GitHub owner/repo/skill ID');
  const [owner, repo, slug] = parts as [string, string, string];
  const temporary = mkdtempSync(join(tmpdir(), 'omx-skill-inspect-'));
  try {
    const result = spawnSync('npx', ['--yes', CLI_PACKAGE, 'add', `${owner}/${repo}`, '--skill', slug,
      '-a', 'codex', '--copy', '-y'], { cwd: temporary, env: { PATH: process.env.PATH, HOME: temporary,
        npm_config_cache: join(temporary, 'npm-cache'), DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1', CI: '1',
        GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null' }, timeout: 90_000, encoding: 'utf8', maxBuffer: 1_000_000 });
    if (result.error || result.status !== 0) throw new Error(`skills.sh CLI inspection failed: ${result.error?.message ?? result.stderr?.slice(0, 500) ?? result.signal ?? result.status}`);
    const root = join(temporary, '.agents', 'skills', slug);
    for (const ancestor of [join(temporary, '.agents'), join(temporary, '.agents', 'skills')]) {
      if (!existsSync(ancestor) || !lstatSync(ancestor).isDirectory()) throw new Error('CLI staged a link or invalid skill directory');
    }
    if (!existsSync(root) || !lstatSync(root).isDirectory()) throw new Error('CLI did not stage the selected skill in the disposable project');
    const files: SkillFile[] = []; let bytes = 0;
    const visit = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name), name = relative(root, path).replaceAll('\\', '/');
        if (entry.isDirectory()) visit(path);
        else if (entry.isFile() && !entry.isSymbolicLink()) {
          const contents = readFileSync(path);
          bytes += contents.byteLength;
          if (files.length >= 100 || bytes > 1_000_000) throw new Error('Inspected skill exceeds 100 files or 1 MB');
          files.push({ path: name, contents: new TextDecoder('utf-8', { fatal: true }).decode(contents) });
        } else throw new Error(`Inspected skill contains a link or non-file: ${name}`);
      }
    };
    visit(root);
    if (!files.some(file => file.path === 'SKILL.md')) throw new Error('Inspected skill lacks SKILL.md');
    const snapshot = filesSnapshot(files)!;
    return { id: safeId, retrievedAt: new Date().toISOString(), platformHash: null, contentSha256: snapshot.hash, files: snapshot.files };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
