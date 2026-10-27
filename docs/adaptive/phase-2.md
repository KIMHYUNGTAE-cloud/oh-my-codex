# Phase 2 — adaptive roles, model allocation and bounded teams

Implementation acceptance contract (2026-10-26). Installed OMX, shared Codex
configuration and authentication remain unchanged. This phase extends the existing
OMX team runtime; it does not introduce a second coordinator.

1. A task first reuses a suitable project role. A missing capability can use a
   task-scoped role draft authored by the current agent. Creating a role does not
   launch a process. Persistent promotion, edits, merge/split and retirement use
   the evidence/evaluate/apply loop, with generated native roles and prompts in a
   recoverable multi-file transaction. User-edited generated files cause conflicts.
2. Model IDs and effort support come from the host catalog. Quality tiers are
   explicit project policy, not inferred from model names. Explicit task model
   requests take precedence; an unavailable or incompatible request is an error.
   Defaults are inherited unless project policy deliberately selects alternatives.
   Each plan snapshots its roles, catalog, model decisions, source context and
   policy. A later default-model change cannot change that plan.
3. Routing compares direct work, one specialist and small teams, considering
   independent ownership, dependencies, context duplication, delegation and
   synthesis overhead. Small or coupled work stays direct. A cap is a maximum,
   not a target number of workers. Estimates are labeled estimates, not savings.
4. The accepted plan supplies frozen per-worker roles, model and effort to the
   existing OMX startTeam path. Runtime policy/permission handling remains intact.
   Direct plans remain in the current main agent. No hidden classifier/reviewer
   model calls. Active team lifecycle stays owned by OMX.
5. Outcomes record requested versus observed settings, unknown usage, verification,
   retries and rework. Actual totals include the leader when supplied; incomplete
   usage cannot support a cost claim. No unbounded automatic retry or escalation.
6. Verification includes meaningful negative cases, multi-file kill/recover,
   deterministic routing and actual runtime/model smoke tests in isolated fixtures.
   Preserve Phase 1 regressions and compare settings across matching runs.

Official host contracts consulted: [subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
and [model/list](https://learn.chatgpt.com/docs/app-server#list-models-modellist).
Model availability is client/account dependent. A catalog entry is not proof that
an inference succeeded, and a requested model is not an observed model.

The broader ROADMAP remains in force: executable skill evolution, upstream refresh,
matched longitudinal effects, and context consolidation are separate later phases.

## Workflow

From an isolated project, use the absolute local fork entrypoint:

```sh
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve init
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve staffing-init
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve models
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve schema
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve plan --file task-plan.json
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve show-plan --plan task-id
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve launch --plan task-id
node /path/to/omx-adaptive/bin/omx-adaptive.mjs team status TEAM_NAME
node /path/to/omx-adaptive/bin/omx-adaptive.mjs team shutdown TEAM_NAME
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve observe --plan task-id --file observation.json
```

`staffing-init` only creates `.omx-project/staffing.json`. Initial profiles all
inherit the explicitly supplied parent model/effort. Configure project profiles
deliberately using `models` output: the runtime cannot infer a model's quality or
price from its identifier. An economy/balanced/deep profile specifies `model`,
`effort` (`inherit`, `default`, or an available effort), and `workTokenFactor` (1
unless supported measurements justify another estimate). No default is copied
back to the user's shared configuration. Explicit per-task `model` overrides the
profile; missing/incompatible models fail instead of silently falling back.

A plan input specifies `id`, `goal`, `parent: {model, effort}`, `mode` (`auto` by
default), `mainContextTokens`, `tasks`, and optional `roleDrafts`. Each task needs
an ID, description, capability tags, minimum quality tier, read/write scope,
context paths, owned write paths, dependency IDs, work/output-token estimates,
and verification conditions. `estimatedTurns` per task and `estimatedMainTurns`
can refine the defaults; these are estimates supplied by the current agent.
`mainContextTokens` means existing conversation context in addition to the host
input floor, not an instruction to inject dummy text.

Role matching uses exact capability tags and scope. Upstream role names are
available as capability tags (for example `explore`, `test-engineer`). Project
roles are preferred. If none covers the task, the current agent can author a
complete role draft: purpose, activation, capabilities, inputs, outputs,
instructions, verification, modelTier and scope. A draft is included in this run's
instructions; no persistent role is installed just because a task needs it.
The parent's existing permissions remain authoritative; a role's scope is a task
contract, not an operating-system sandbox.

Persistent creation, edits, merge/split and retirement use an incident-backed
proposal with `roles: {schemaVersion: 1, roles: [...]}` instead of `entry`.
Reproduction/regression checks may specify `categories: ["roles"]` to distinguish
them from guidance checks. Roles are excluded from automatic apply by default.
The compiler emits deterministic source, native TOML and team prompts together.
Never edit the generated assets: a mismatch prevents replacement and rollback.

## Runtime and cost boundaries

The current agent performs the semantic decomposition. The planner performs
deterministic matching, capability validation, consolidation and admission. It
does not independently understand task difficulty or promise model quality.
Duplicate-compatible work shares a worker. Missing coverage, overlapping write
ownership, read/write dependencies on frozen context, and no independent work
prevent a team. Direct plans start zero processes. An explicit specialist/team
request can override the savings preference but cannot exceed budget/ownership
constraints. A maximum worker count is not a target staffing level.

An OMX team uses its existing tmux lifecycle. Each worker receives the snapshot's
role text, exact model and effort. Workers have native delegation disabled, tasks
have `delegation.mode = none`, and runtime `max_workers` equals the planned count.
Scale-up requires ending the run and producing a new budgeted plan. Resume keeps
the existing processes; this phase does not automatically restart/escalate failed
workers. Each plan has one dispatch attempt, including a failed start. Inspect
the upstream runtime before retrying with a new plan.

The token budget is an **admission estimate**, not a server-enforced spending cap.
The v2 estimate counts repeated input over estimated tool turns, the main agent's
coordination context, worker protocol turns and synthesis. It counts cached input
tokens in total usage; it does not convert tokens to money or account quota.
Initial conservative floors are 16,000 host input tokens, five worker lifecycle
turns and two main coordination turns. They are configurable assumptions informed
by the isolated pilot, not universal model constants.

`observe` accepts exact worker/leader JSONL paths and hashed verification artifacts.
It supports Codex exec completion usage and native rollout cumulative token usage.
Partial rollouts stay partial; absent usage/cache/model/effort data stays unknown.
It records observed settings separately from requested settings. Duplicate event
paths, including path aliases, are rejected. Verification remains an artifact-backed
reporter claim; this is not a general semantic judge.

Matching completed worker observations with unchanged event/verification artifacts,
matching observed model/effort and passing verification can raise the next plan's
input-token floor. They never automatically lower estimates or select a stronger
model. The plan records the calibration evidence digests. This closes an initial
observation-to-next-plan loop without rewriting user preferences or introducing
an automatic retry process.

## Verification

`scripts/adaptive-team-smoke.py` is opt-in and uses actual Codex models in an
isolated tmux server, project and HOME. `ADAPTIVE_TEST_TMUX` may select a test-local
tmux binary; no global installation is required. The pilot compares the same tiny
fixture in direct execution and a forced two-worker team, confirms actual model
metadata and task completion, checks that automatic routing selects direct, and
uses the existing OMX shutdown path. It demonstrates the measured overhead of
overstaffing that case, not universal team savings. Account auth is copied without
refresh credentials, removed in finally, and the original is hashed before/after.

Final verification: **1,332 tests passed, zero failures/skips**. The accepted real
pilot is `.local-tests/team-smoke-e78206e5/report.json`: GPT-6 Luna/high and the
user's snapshotted GPT-6 Astra/medium both completed their actual checks. The
fixture's direct baseline used 42,003 total tokens; worker work used 353,292
before shutdown (a lower bound for the team lifecycle, with cached input included).
Automatic routing selected direct. These numbers are observations for this small
fixture, not prices or general model comparisons. Its subsequent
`feedback-report.json` confirms that two actual, verified worker observations
became calibration evidence for the next plan.

Earlier pilots are retained as diagnostics. The first established model execution
but did not prove fork CLI isolation. The second exposed login-shell PATH
reordering that selected the installed `omx` for worker API commands. Adaptive
protocols now bind the fork's Node/CLI paths explicitly; the accepted pilot checks
actual executed commands, rejects bare OMX invocations, confirms the worker cap,
and completes normal OMX shutdown. Symbolic task dependencies are bound to the
actual allocated task IDs, and independent tasks use explicit lightweight
coordination instead of keyword-triggered extra delegation protocols.

See [phase-2-verification.json](phase-2-verification.json) for the complete evidence
map, source hashes, isolation checks and limits.
