# Agent-managed project evolution

Run these commands from the target project's root, using this fork's absolute
entrypoint. The public command name is `evolve`, under `omx-adaptive`.

For a new project, connect this fork's native hooks with project scope once:

```sh
node /path/to/omx-adaptive/bin/omx-adaptive.mjs setup --scope project
```

Review any existing project setup files before running setup. The setup command
uses OMX's existing project backup and ownership behavior; it does not install
this fork into the user's shared Codex home.

```sh
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve auto on
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve auto status
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve models
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve models candidates set --file candidates.json
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve models candidates list
# Or add and remove individual candidates without editing JSON:
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve models candidates add MODEL_ID_A --tier economy --efforts low,medium
node /path/to/omx-adaptive/bin/omx-adaptive.mjs evolve models candidates remove MODEL_ID_A
```

`auto on` initializes project evolution and staffing if absent, enables the
project's policy, and includes all five change categories in `autoApply`:
knowledge, instruction, procedure, roles and skills. The fork's SessionStart
guidance then directs the current agent to handle evidence, proposals, trusted
reproduce/regression checks, evaluation, role and skill discovery, task planning,
bounded team launch and observations when relevant. This is an agent workflow,
not a background model call or a new team coordinator. The fork's project-scope
hook must be connected for automatic session guidance; `auto on` alone does not
install hooks or change the user's shared Codex configuration.
There is no separate approval button. Codex's existing tool permissions govern
agent actions, while an already evaluated ready proposal in an enabled
`autoApply` category can be applied without a new confirmation prompt.

Automatic application still requires a ready evaluation, unchanged evidence,
candidate, project snapshot and policy, and inactive session state. A clean
bound-launch settlement considers at most three ready proposals. A failed or
missing check leaves the proposal pending. The agent may author project check
configuration, but evaluator commands must be trusted and remain within the
existing process and permission boundaries. Role and skill artifacts retain
their atomic apply, recovery and rollback rules.

`auto off` stops agent-managed workflow guidance and sets `autoApply` to an empty
list. It does not erase accepted project configuration or undo applied changes.
Toggling either mode changes project policy bytes, so previously evaluated
proposals need reevaluation. Manual `evolve` commands remain available.

## Model candidates

Use `evolve models` to inspect the live Codex host catalog. A candidate file is
project-owned and assigns model quality tiers explicitly; names do not imply
quality. Example:

```json
{
  "candidates": [
    { "model": "MODEL_ID_A", "tier": "economy", "efforts": ["low", "medium"] },
    { "model": "MODEL_ID_B", "tier": "deep", "efforts": ["medium", "high"] }
  ]
}
```

`models candidates set --file` validates every model and effort against the live
host catalog before writing `.omx-project/staffing.json`. A nonempty pool limits
adaptive worker assignments, including task-specific model overrides, to those
candidates. A task can use its declared tier or a higher one. When a profile
inherits a parent model outside the pool, planning picks the lowest admissible
tier from the configured candidates and a supported effort. Direct main-agent
work keeps the user's current model. Saved plans snapshot their model decisions;
changing candidates invalidates those plans rather than silently changing a
worker at dispatch.

`evolve models candidates clear` removes the project allowlist and restores the
previous inherited/profile selection rules. It does not edit the user's default
model or prove model quality, token savings or price. Team launch still requires
the existing ownership, token estimate, permission and task-scope checks.
