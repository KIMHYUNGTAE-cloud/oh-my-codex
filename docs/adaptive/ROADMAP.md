# Accepted direction after Phase 1

Phase 2 implements role catalog transactions, task-scoped role drafts, host-validated
model/effort selection, immutable plans, existing-team dispatch and conservative
observation-based overhead calibration. See [phase-2.md](phase-2.md) for its contract
and boundaries. The remaining items below continue to describe later work; Phase 2
does not claim general model-quality optimization or statistically proven savings.

Phase 3 implements project-owned skill discovery, source compilation, evaluated
multi-file apply/recovery/rollback and role binding. See [phase-3.md](phase-3.md).
Skills.sh candidates remain untrusted until reviewed and independently evaluated;
remote auto-update and global installation are not part of this phase.

Phase 1 is the verified bounded project-guidance evolution loop. This roadmap
preserves the broader acceptance targets, including those only partially covered
by Phase 2. It is not an authorization to change the installed OMX.

## Project-owned configuration and upstream updates

- Keep upstream defaults, project-owned role/skill/routing sources, and generated
  execution assets distinguishable. Project evolution edits the owned source.
- Compile the effective configuration deterministically; pin its digest per run.
- Preview upstream changes and preserve project edits on refresh, including conflicts.
- Start by extending this fork's existing execution/team runtime. Do not import
  the HarnessBase runtime or build a second coordinator or viewer architecture.

## Broader evolution targets

1. **Project knowledge and decisions:** retain evidence, applicability, supersession,
   and retirement; consolidate redundant guidance as the project changes.
2. **Reusable skills:** create and update executable SKILL.md artifacts from verified
   working procedures, with dependency/activation/reference validation and actual
   task cases. Phase 3 covers this initial loop and an independent fixture case;
   broader longitudinal quality effects remain to be measured.
3. **Agent roles:** add, modify, combine, split and remove project-local roles as
   work warrants. A role needs a purpose, activation conditions, input/output,
   capabilities, model policy and completion/verification contract. Role creation
   does not imply starting another process or keeping it running.
4. **Model/reasoning allocation:** respect explicit user preferences and use
   available host capabilities. Snapshot selected settings per comparison/run;
   changes to the user's global default must not alter an already-running pair.
   Preserve requested versus observed settings and unknown usage as separate data.
5. **Routing and orchestration:** choose direct main work, a specialist or a team
   according to task structure. Measure delegation overhead, repeated exploration,
   duplicated work and rework; more agents is not an acceptance criterion.
6. **Context:** retrieve relevant project knowledge/skills by task, preserve compact
   durable handoffs and avoid repeatedly injecting the entire accumulated history.
7. **Tools and connections:** evaluate project-specific CLI/MCP/skill needs and
   compatibility. Changes to external connections, authentication, executable hooks
   or permissions use their own explicit scope and verification.
8. **Verification and effects:** use candidate reproduction and independent regression
   cases, then comparable real-work observations. Keep application, observed effects,
   causal attribution and price claims distinct. Roll back only when the evidence
   and unchanged-current-config preconditions are satisfied.

## Implementation sequence to review next

- Extend source and transaction coverage to project skill assets (Phase 3 done).
- Add a read-only model/capability adapter and immutable effective-config snapshots.
- Add one role-creation and one model-routing acceptance case in isolated fixtures.
- Extend evaluation by change category, with explicit model budgets where needed.
- Add matched multi-run effects, consolidation/retirement, and upstream merge cases.

Each step must retain the Phase 1 evidence/apply/recovery/rollback tests and current
OMX behavior. Keep project test homes isolated and publish development work on
the personal fork's `adaptive/project-evolution` branch. Project installation
remains a separate, project-scoped step.
