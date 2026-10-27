# Phase 3 — project skill discovery and evolution

This phase extends the isolated OMX Adaptive fork. It does not install into the
user's shared Codex or OMX configuration. A new project's skill catalog remains
empty until that project explicitly records, evaluates and applies a proposal.

## Contract

1. Existing project skills are checked before external discovery. An agent may run
   `evolve find-skills --query ...` when a reusable capability is missing.
   `skills.sh` results are candidates, not trusted instructions or proof of quality.
2. The public skills.sh API currently requires Vercel OIDC. The command therefore
   invokes the official `skills@1.7.4` CLI in a disposable HOME and working
   directory with telemetry disabled. `find` returns candidate metadata.
   `inspect-skill --id owner/repo/skill` copies a public candidate only into that
   disposable directory and returns its text files and a local SHA-256. Neither
   command writes a project or global skill folder. The agent must review the
   returned source before using it in a proposal. Private sources are outside
   this CLI inspection path.
3. The reviewed, project-owned `.omx-project/skills.json` catalog contains the
   skill's purpose, activation conditions, Codex/project compatibility,
   dependency IDs, provenance, source text and a digest covering all source
   files. A source may have `SKILL.md` body instructions and up to three bounded
   supporting text or script files. Compilation never runs scripts. Remote
   `install`, hooks, permissions and arbitrary file paths are not catalog fields.
4. The compiler deterministically emits `.agents/skills/adaptive-<id>/SKILL.md`
   and its reviewed supporting files. Source and generated files are applied in
   one recoverable multi-file transaction. User edits to generated files block
   replacement or rollback. The existing incident, independent reproduction and
   regression, evaluation digest, clean-session apply, recovery and rollback
   rules apply. Skills are excluded from automatic apply by default.
5. A project role may list skill IDs. Planning rejects missing or edited skill
   assets, snapshots their hashes, includes a path in the role instructions and
   accounts for potential skill context in the worker token estimate. A changed
   skill invalidates a saved plan. A role's skill binding does not change the
   parent's permissions or spawn another agent. Role promotion requires already
   applied skill assets, and retiring a skill requires retiring or updating its
   active role bindings first.

## Typical flow

From the target project, call the local fork by absolute path:

```sh
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve init
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve find-skills --query 'schema verification'
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve inspect-skill --id owner/repo/skill
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve schema
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve record --file incident.json
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve propose --file skill-proposal.json
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve evaluate --proposal proposal-id
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve apply --proposal proposal-id
```

The proposal's `skills` member is the complete next catalog, so additions,
revisions, consolidation and retirement pass through the same transaction.
Evaluation policy must register `reproduce` and `regression` checks with
`categories: ["skills"]` (or checks intentionally shared across categories).
Use a task case distinct from the authoring example to test transfer. For
sourced skills, record the original URL/revision and use `skillSourceDigest`
to pin the reviewed bytes. A later source update is a new proposal and evaluation.

Generated `SKILL.md` links are relative to the skill folder. Its instructions
state the project-root prefix to use when running a linked script. Candidate
scripts execute only when a later Codex task chooses to run them under the
existing host permissions; importing and compiling never executes them.

## Verification and limits

The local verification record is [phase-3-verification.json](phase-3-verification.json).
It includes compiler and transaction tests, actual `skills.sh` CLI discovery and
inspection, compilation of an inspected first-party source without installation,
native Codex skill loading, and one live independent-case model run.
The final repository-wide `npm test` run passed: 476 test files, 8,983 passing
tests, no failures, and 82 environment-dependent skips. Its log and execution
conditions are recorded in the verification JSON.
The live model run proves the generated skill was used for its fixture. It does not prove
that an arbitrary public skill is safe or improves every future project task.

The skills.sh CLI is an external npm package, pinned to the version tested here;
it runs only on explicit search/inspect requests, in a temporary directory with
an empty HOME and no inherited credentials. Network access and npm availability
are needed. The public API adapter remains available for authenticated callers;
without Vercel OIDC it returns the public search page and an authentication
notice. No automatic selection by download count, no remote auto-update and no
global skill installation are implemented.

OpenAI's [repo-local skill guidance](https://developers.openai.com/blog/skills-agents-sdk)
documents `.agents/skills/`, metadata-first discovery and loading supporting
files only when needed. The [skills.sh CLI](https://github.com/vercel-labs/skills)
documents `find` and project-scope `add`; its [API reference](https://www.skills.sh/docs/api)
documents the OIDC requirement.
