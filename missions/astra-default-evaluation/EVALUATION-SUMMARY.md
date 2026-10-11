# Issue #3655: Representative Cost/Quality Evaluations for OMX Astra Defaults

## Executive Summary

This evaluation framework establishes a structured comparison of OMX default model configurations, with Astra (GPT-6 Astra) as the baseline. Synthetic records demonstrate the harness and reporting pipeline; live evaluation will measure quality, usage, latency, and repair costs across configurations.

## Evaluation Declarations

### Baseline Configuration
- **astra-defaults**: GPT-6 Astra (medium reasoning effort) across all roles
  - Status: Baseline for all comparisons
  - Revision: 8f7c1f207df1408e28dfd8ad7f62e7e4a95eab2b
  - Purpose: Production default established in #3622

### Candidate Configurations

#### Luna Uniform (`luna-uniform`)
- **Model**: GPT-5.6 Luna (medium reasoning effort)
- **Roles**: All roles (explore, executor, code-reviewer, team-worker, sparkshell)
- **Rationale**: Lighter-weight model for cost/latency comparison
- **Expected Outcome**: Measure if Luna maintains quality while reducing token usage

#### GPT-6.1 Sol Candidate (`gpt-6.1-sol-candidate`)
- **Model**: GPT-6.1 Sol (medium reasoning effort)
- **Roles**: All roles
- **Rationale**: Next-generation Sol model candidate for potential improved quality
- **Expected Outcome**: Measure if Sol candidate improves quality without cost penalty

#### GPT-6 Sol Control (`gpt-6-sol-control`)
- **Model**: GPT-6 Sol (medium reasoning effort)
- **Roles**: All roles
- **Rationale**: Previous-generation Sol as control for incremental improvement measurement
- **Expected Outcome**: Establish baseline comparison for Sol variants

### Additional Comparison Configs
- **mixed-luna-light-roles**: Luna for lightweight roles (explore, team-worker, sparkshell); Astra for deep roles (executor, code-reviewer)
- **terra-override**: Terra across all roles (existing supported override)

## Fixtures and Checks

Six task fixtures span evaluated surfaces with deterministic baselines for sparkshell tasks:

| Fixture | Surface | Quality Checks | Deterministic Baseline |
|---------|---------|---|---|
| explore-locate-stop-nudge | explore | names implementing source + no followup work | No |
| executor-bounded-change | executor | mentions required tests + no scope inflation | No |
| code-reviewer-known-defect | code-reviewer | finds planted defect + no false positive | No |
| team-worker-delegated-task | team-worker | names changed file + reports check outcome + no continuation | No |
| sparkshell-failing-tests | sparkshell | exact test name extraction | Yes (extractor: failing-test-names) |
| sparkshell-exit-status | sparkshell | exact exit code extraction | Yes (extractor: exit-status) |

## Synthetic Records and Report

A representative synthetic evaluation (`records-synthetic.json`) demonstrates:
- **36 task records** (6 fixtures × 6 configurations)
- **Pass rate**: 5/6 configurations at 100% pass; Luna uniform at 83% (fails code-reviewer-known-defect)
- **Usage patterns**:
  - Astra: 12,300 input tokens / 2,490 output tokens
  - Luna uniform: 10,300 input tokens / 1,970 output tokens (↓16% input, ↓21% output)
  - Sol candidates: Higher output (reasoning cost) vs. Astra
- **Latency**: Vary by 1.3–1.8s for explore tasks; 2.9–3.8s for executor tasks
- **Repair costs**: Luna uniform required 2 retries + 3 operator minutes; others 0–1

## Report Output

Generated report (`REPORT-issue-3655-synthetic.md`) includes:
1. Configuration matrix with model/effort per surface
2. Stage settings (launch-resolved vs. runtime-observed)
3. Aggregate per-configuration summary (pass count, difficult cases, retries)
4. Usage observations (input/output/cache breakdown by fixture and config)
5. Failed and difficult cases (code-reviewer-known-defect @ luna-uniform marked as difficult)
6. Cost claims (transparency: incomplete attribution noted where model usage cannot be verified)
7. Workload-weighted summary (not yet possible without documented task frequencies)

## Key Findings (Synthetic Data)

⚠️ **Synthetic records are illustrative examples; they do not represent actual model evaluation.**

- **Luna uniform**: 16% reduction in input tokens but fails one critical task (code review)
- **Sol candidates**: Comparable or higher output token usage; quality parity with Astra
- **No changes to shipped defaults**: Evidence does not support revising Astra as the baseline

## Next Steps

1. **Live evaluation run**: Execute fixtures against live OMX instances with each configuration
   - Capture actual usage from provider APIs
   - Record operator intervention time for repair tasks
   - Document launch and runtime settings
   - Link workflowIds for stage-level accounting

2. **Evidence collection**:
   - Required checks (build/tests) pass/fail status
   - Response text grading against fixture checks
   - Provider token counters (if available)
   - Latency measurements from OMX runner

3. **Representative claims**:
   - Document task frequency for each fixture to enable workload-weighted claims
   - Only declare cost/quality savings when all required evidence is complete

## Audit Trail

- Created 2026-10-11 at commit 8f7c1f207
- Evaluation framework sourced from src/evals/astra-defaults
- Configurations pinned to omx revision 8f7c1f207df1408e28dfd8ad7f62e7e4a95eab2b
- Synthetic records serve as regression tests for report harness

## Decisions NOT Made

✅ Astra remains the shipped default for all roles
✅ No model rotation deployed
✅ No changes to reasoning-effort configuration
✅ No new OMX features required to support this evaluation

This evaluation framework is intentionally isolated from OMX's runtime; it measures only declared outcomes and supplied observations. No inference is made about model quality, cost, or user experience without explicit live evidence.
