# OMX Adaptive — isolated project evolution

Local development fork of **OMX v0.21.36**, upstream commit
`fe09b80e76e85105c10840730bdca5397247a9e4`, on `adaptive/project-evolution`.
The official repository is remote `upstream`. No global package, command, or
user/project configuration is installed by this fork.

## Implemented scope

Project knowledge, instructions and reusable procedures evolve through:

1. Evidence-bound incident (user correction, verified finding, or harness issue).
2. Proposal replacing/adding one scoped guidance entry.
3. Isolated baseline/candidate reproduction and regression command checks.
4. Atomic journaled apply after rechecking source, policy, candidate and evidence.
5. SessionStart/UserPromptSubmit delivery, with keyword-scoped complete entries.
6. Restore-if-unchanged rollback and explicit interrupted-transaction recovery.

Phase 2 adds project roles, task-scoped role creation, host-validated model/effort
allocation, immutable staffing plans, and dispatch through the existing OMX team
runtime. See [the phase contract and usage](phase-2.md). The planner includes repeated
input across tool turns, leader coordination, worker lifecycle and scoped context.
Actual verified observations can conservatively raise subsequent cost estimates.
There is no hidden planner/reviewer model call and no automatic escalation loop.

Phase 3 adds project-owned skills: explicit skills.sh discovery and inspection,
reviewed source manifests, deterministic `.agents/skills` assets, evaluated
apply/recovery/rollback, and role-to-skill binding. See [phase-3.md](phase-3.md).

`evolve auto on|off|status` enables or disables agent-managed project workflow
and automatic application of evaluated categories. `evolve models candidates`
sets a host-validated project model pool. See [auto-mode.md](auto-mode.md) for
commands, safety gates and model selection behavior.

The current agent extracts the lesson. No classifier/reviewer model is launched by
the runtime. Opted-in SessionStart context tells the agent how to record/propose;
it does not create an incident for an ordinary successful ending. Only pre-evaluated
ready proposals are eligible for automatic application after successful bound OMX
launch cleanup. Other entrypoints can invoke the explicit CLI after their session.

## Local usage

```sh
# In this checkout, dependencies/build stay local. Install scripts are unnecessary.
npm ci --ignore-scripts --cache .local-tests/npm-cache
npm run build
node bin/omx-adaptive.mjs evolve help
```

From an **isolated test project**, invoke the entrypoint by absolute path:

```sh
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve init
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve schema
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve record --file incident.json
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve propose --file proposal.json
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve evaluate --proposal fix-qa
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve apply --proposal fix-qa --automatic
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve context --query 'run tests'
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve rollback --proposal fix-qa
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve recover
```

`evolve init` creates project files only; it does **not** register Codex hooks or
run OMX setup. Fork-native hooks deliver context when used through this checkout's
OMX installation. `evolve hook` is a narrow adapter for an explicitly configured
isolated native hook; it accepts SessionStart/UserPromptSubmit JSON on stdin.

## Sources of truth

| Path | Ownership |
| --- | --- |
| `.omx-project/policy.json` | Project-reviewed evaluation commands, budgets and automatic categories |
| `.omx-project/guidance.json` | Accepted scoped entries; commit-friendly project configuration |
| `.omx-project/roles.json` | Accepted role catalog; source for generated agent TOML and team prompts |
| `.omx-project/skills.json` | Accepted project skill catalog; source for generated `.agents/skills/adaptive-*` assets |
| `.omx-project/staffing.json` | Explicit model profiles, token estimates and staffing limits |
| `.omx/evolution/ledger.json` | Private incident/proposal/evaluation/application history |
| `.omx/evolution/transaction.json` | Pending transaction; blocks writes/context until recovery |
| `.omx/evolution/plans/` | Immutable role, model, context, policy and host snapshots |
| `.omx/evolution/observations/` | Artifact-bound usage and verification reports; unknown usage remains unknown |

Guidance references project artifacts by path/SHA256. It does not copy complete
transcripts into shared project configuration. The source snapshot excludes `.git`,
`.omx`, `.local-tests`, and `node_modules`; it refuses links and is bounded to
2000 files / 16 MB. Checks therefore need interpreter-based scripts and available
external dependencies; dependency-heavy projects need a dedicated snapshot adapter.

Policy check commands are explicit project configuration, executed without a shell.
Each check and each arm gets a separate copy and HOME/CODEX_HOME; credentials,
parent hooks and session identity are not inherited. The runner kills its child
process group on timeout and exit. This is process cleanup, **not an OS sandbox**:
configured evaluators must be trusted. Check output is hashed, not copied to receipts.
Missing commands, timeout and transport/runner failures cannot qualify as reproduction.

## Apply rules and limits

- Both a reproduce and regression check are mandatory. Reproduction must fail
  before and pass after; regression must pass in both arms. Receipts bind the exact
  source, policy, candidate and evidence. Any subsequent source drift requires reevaluation.
- Automatic application follows the project's enabled `autoApply` categories;
  `evolve auto on` includes roles and skills as well.
  A recorded user correction can qualify directly after evaluation. Agent-inferred
  findings require the configured recurrence threshold and independent task scopes.
  Attribution/session IDs are agent reports, **not authenticated semantic proof**.
- Generated targets are scoped guidance, the role catalog's reserved
  `.codex/agents/adaptive-*.toml` / `.codex/prompts/adaptive-*.md` assets, and
  the skill catalog's `.agents/skills/adaptive-*` assets. Role and skill
  proposals use a multi-file journal with exact preconditions and recovery; a
  pending transaction blocks adaptive planning/launch. Native files are separate
  files, so recover before starting any new Codex session after a crash.
  The engine cannot rewrite global config, staffing policy, MCP, executable hooks, or application files.
  Guidance remains subject to the host's instructions, permissions and verification.
- Persistent apply/rollback/recovery conservatively refuse unresolved OMX session
  pointers and alternate runtime state roots. The first version does not hot-reload
  running role definitions. Guidance activates at the next context read.
- Bound-launch settlement considers at most three ready proposals, performs no
  model call and leaves stale/disabled/blocked proposals deferred. Detached launcher
  automatic settlement is not integrated in this milestone.
- Rollback restores the prior complete guidance only if the applied bytes remain
  unchanged. Later edits or dependent changes produce a conflict.
- Accepted guidance is authoritative project configuration; do not manually edit
  private ledger/journal files. A journal is a recovery record, not a security token.

## Verification

```sh
npm run build
node --test dist/evolution/__tests__/service.test.js
```

Use dedicated HOME/CODEX_HOME when running upstream tests. Their normal test path
also requires `cargo build -p omx-runtime --locked`; a TS-only checkout gives many
runtime-dependent failures. Preserve failed runs as diagnostics.

The **opt-in** real-model pilot is:

```sh
python3 scripts/adaptive-model-smoke.py
```

It uses the user's configured model, isolated HOME/CODEX_HOME and reviewed test hooks.
An owner-private temporary ChatGPT auth copy omits refresh credentials and is deleted
in finally. Original auth is hashed before/after. Credentials are never retained in
reports or committed. Override account source/bin discovery with
`ADAPTIVE_TEST_AUTH_HOME` / `ADAPTIVE_TEST_CODEX_BIN` when needed.

The pilot runs five independent actual model sessions: baseline, correction recording,
fresh task with accepted guidance, unrelated task, and task after rollback. It checks
native hook delivery and an actual successful test command, not only model assertions.
The deterministic proposal evaluation proves the configured policy behavior; the
separate model pilot observes actual behavior. Neither establishes general quality
improvement, statistical causality or cost savings. Usage is retained as observed.

## Deliberately deferred

- Executable SKILL.md emission and automatic quality-based model-policy promotion.
- General semantic evaluators, matched multi-run effects and automatic effect rollback.
- Upstream setup preservation adapters and configuration categories beyond guidance/roles.
- Large dependency-aware evaluation workspaces and distributed session coordination.

Keep these in separate changes with acceptance cases. Preserve the upstream Git
history, isolate development in this checkout, and validate upstream updates before
merging them. Do not use npm link or replace the globally installed `omx` for trials.
