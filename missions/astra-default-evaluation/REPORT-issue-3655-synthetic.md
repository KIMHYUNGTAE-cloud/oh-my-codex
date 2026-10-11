# OMX default-model evaluation report

**Synthetic supplied observations — accounting examples, not measured model results.**

## Configurations
| config | baseline | omx revision | service tier | cache | code-reviewer | executor | explore | sparkshell | team-worker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| astra-defaults | yes | 8f7c1f207df1408e28dfd8ad7f62e7e4a95eab2b | unknown | unknown (Codex-owned; record observed conditions per run) | gpt-6-astra / medium | gpt-6-astra / medium | gpt-6-astra / medium | gpt-6-astra / medium | gpt-6-astra / medium |
| gpt-6-sol-control | no | 8f7c1f207df1408e28dfd8ad7f62e7e4a95eab2b | unknown | unknown (Codex-owned; record observed conditions per run) | gpt-6-sol / medium | gpt-6-sol / medium | gpt-6-sol / medium | gpt-6-sol / medium | gpt-6-sol / medium |
| gpt-6.1-sol-candidate | no | 8f7c1f207df1408e28dfd8ad7f62e7e4a95eab2b | unknown | unknown (Codex-owned; record observed conditions per run) | gpt-6.1-sol / medium | gpt-6.1-sol / medium | gpt-6.1-sol / medium | gpt-6.1-sol / medium | gpt-6.1-sol / medium |
| luna-uniform | no | 8f7c1f207df1408e28dfd8ad7f62e7e4a95eab2b | unknown | unknown (Codex-owned; record observed conditions per run) | gpt-5.6-luna / medium | gpt-5.6-luna / medium | gpt-5.6-luna / medium | gpt-5.6-luna / medium | gpt-5.6-luna / medium |
| mixed-luna-light-roles | no | 8f7c1f207df1408e28dfd8ad7f62e7e4a95eab2b | unknown | unknown (Codex-owned; record observed conditions per run) | gpt-6-astra / medium | gpt-6-astra / medium | gpt-5.6-luna / medium | gpt-5.6-luna / medium | gpt-5.6-luna / medium |
| terra-override | no | 8f7c1f207df1408e28dfd8ad7f62e7e4a95eab2b | unknown | unknown (Codex-owned; record observed conditions per run) | gpt-5.6-terra / medium | gpt-5.6-terra / medium | gpt-5.6-terra / medium | gpt-5.6-terra / medium | gpt-5.6-terra / medium |
Role pins above are configuration values; they do not prove runtime settings.

## Stage settings
| fixture / workflow | config / stage | surface / role | requested model / effort | override source (model / effort) | launch-resolved (source) | runtime-observed (source) |
| --- | --- | --- | --- | --- | --- | --- |
| explore-locate-stop-nudge / unknown | astra-defaults / unknown | unknown | unknown | unknown | unknown | unknown |
| explore-locate-stop-nudge / unknown | luna-uniform / unknown | unknown | unknown | unknown | unknown | unknown |
| explore-locate-stop-nudge / unknown | mixed-luna-light-roles / unknown | unknown | unknown | unknown | unknown | unknown |
| explore-locate-stop-nudge / unknown | terra-override / unknown | unknown | unknown | unknown | unknown | unknown |
| explore-locate-stop-nudge / unknown | gpt-6.1-sol-candidate / unknown | unknown | unknown | unknown | unknown | unknown |
| explore-locate-stop-nudge / unknown | gpt-6-sol-control / unknown | unknown | unknown | unknown | unknown | unknown |
| executor-bounded-change / unknown | astra-defaults / unknown | unknown | unknown | unknown | unknown | unknown |
| executor-bounded-change / unknown | luna-uniform / unknown | unknown | unknown | unknown | unknown | unknown |
| executor-bounded-change / unknown | mixed-luna-light-roles / unknown | unknown | unknown | unknown | unknown | unknown |
| executor-bounded-change / unknown | terra-override / unknown | unknown | unknown | unknown | unknown | unknown |
| executor-bounded-change / unknown | gpt-6.1-sol-candidate / unknown | unknown | unknown | unknown | unknown | unknown |
| executor-bounded-change / unknown | gpt-6-sol-control / unknown | unknown | unknown | unknown | unknown | unknown |
| code-reviewer-known-defect / unknown | astra-defaults / unknown | unknown | unknown | unknown | unknown | unknown |
| code-reviewer-known-defect / unknown | luna-uniform / unknown | unknown | unknown | unknown | unknown | unknown |
| code-reviewer-known-defect / unknown | mixed-luna-light-roles / unknown | unknown | unknown | unknown | unknown | unknown |
| code-reviewer-known-defect / unknown | terra-override / unknown | unknown | unknown | unknown | unknown | unknown |
| code-reviewer-known-defect / unknown | gpt-6.1-sol-candidate / unknown | unknown | unknown | unknown | unknown | unknown |
| code-reviewer-known-defect / unknown | gpt-6-sol-control / unknown | unknown | unknown | unknown | unknown | unknown |
| team-worker-delegated-task / unknown | astra-defaults / unknown | unknown | unknown | unknown | unknown | unknown |
| team-worker-delegated-task / unknown | luna-uniform / unknown | unknown | unknown | unknown | unknown | unknown |
| team-worker-delegated-task / unknown | mixed-luna-light-roles / unknown | unknown | unknown | unknown | unknown | unknown |
| team-worker-delegated-task / unknown | terra-override / unknown | unknown | unknown | unknown | unknown | unknown |
| team-worker-delegated-task / unknown | gpt-6.1-sol-candidate / unknown | unknown | unknown | unknown | unknown | unknown |
| team-worker-delegated-task / unknown | gpt-6-sol-control / unknown | unknown | unknown | unknown | unknown | unknown |
| sparkshell-failing-tests / unknown | astra-defaults / unknown | unknown | unknown | unknown | unknown | unknown |
| sparkshell-failing-tests / unknown | luna-uniform / unknown | unknown | unknown | unknown | unknown | unknown |
| sparkshell-failing-tests / unknown | mixed-luna-light-roles / unknown | unknown | unknown | unknown | unknown | unknown |
| sparkshell-failing-tests / unknown | terra-override / unknown | unknown | unknown | unknown | unknown | unknown |
| sparkshell-failing-tests / unknown | gpt-6.1-sol-candidate / unknown | unknown | unknown | unknown | unknown | unknown |
| sparkshell-failing-tests / unknown | gpt-6-sol-control / unknown | unknown | unknown | unknown | unknown | unknown |
| sparkshell-exit-status / unknown | astra-defaults / unknown | unknown | unknown | unknown | unknown | unknown |
| sparkshell-exit-status / unknown | luna-uniform / unknown | unknown | unknown | unknown | unknown | unknown |
| sparkshell-exit-status / unknown | mixed-luna-light-roles / unknown | unknown | unknown | unknown | unknown | unknown |
| sparkshell-exit-status / unknown | terra-override / unknown | unknown | unknown | unknown | unknown | unknown |
| sparkshell-exit-status / unknown | gpt-6.1-sol-candidate / unknown | unknown | unknown | unknown | unknown | unknown |
| sparkshell-exit-status / unknown | gpt-6-sol-control / unknown | unknown | unknown | unknown | unknown | unknown |
| sparkshell-exit-status / unknown | deterministic-no-model / unknown | unknown | unknown | unknown | unknown | unknown |
| sparkshell-failing-tests / unknown | deterministic-no-model / unknown | unknown | unknown | unknown | unknown | unknown |

## Per-task results
| fixture | config | declared outcome | failed response checks | retries | workflow elapsed ms | input/output | operator min | response grade | required checks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| explore-locate-stop-nudge | astra-defaults | pass | — | 0 | 1850 | 2400/480 | 0 | pass | pass |
| explore-locate-stop-nudge | luna-uniform | pass | — | 0 | 1620 | 1800/320 | 0 | pass | pass |
| explore-locate-stop-nudge | mixed-luna-light-roles | pass | — | 0 | 1650 | 1850/340 | 0 | pass | pass |
| explore-locate-stop-nudge | terra-override | pass | — | 0 | 1750 | 2100/400 | 0 | pass | pass |
| explore-locate-stop-nudge | gpt-6.1-sol-candidate | pass | — | 0 | 1500 | 2200/520 | 0 | pass | pass |
| explore-locate-stop-nudge | gpt-6-sol-control | pass | — | 0 | 1700 | 2300/480 | 0 | pass | pass |
| executor-bounded-change | astra-defaults | pass | — | 0 | 3200 | 4500/950 | 1 | pass | pass |
| executor-bounded-change | luna-uniform | pass | — | 1 | 3800 | 3800/750 | 2 | pass | pass |
| executor-bounded-change | mixed-luna-light-roles | pass | — | 0 | 3100 | 4200/880 | 1 | pass | pass |
| executor-bounded-change | terra-override | pass | — | 0 | 3300 | 4600/920 | 1 | pass | pass |
| executor-bounded-change | gpt-6.1-sol-candidate | pass | — | 0 | 2900 | 4700/1000 | 0 | pass | pass |
| executor-bounded-change | gpt-6-sol-control | pass | — | 0 | 3100 | 4800/970 | 1 | pass | pass |
| code-reviewer-known-defect | astra-defaults | pass | — | 0 | 2400 | 3200/640 | 0 | pass | pass |
| code-reviewer-known-defect | luna-uniform | fail | finds-permanent-suppression | 1 | 2600 | 2800/520 | 3 | fail | fail |
| code-reviewer-known-defect | mixed-luna-light-roles | pass | — | 0 | 2350 | 3100/620 | 0 | pass | pass |
| code-reviewer-known-defect | terra-override | pass | — | 0 | 2500 | 3300/660 | 0 | pass | pass |
| code-reviewer-known-defect | gpt-6.1-sol-candidate | pass | — | 0 | 2200 | 3400/700 | 0 | pass | pass |
| code-reviewer-known-defect | gpt-6-sol-control | pass | — | 0 | 2300 | 3300/680 | 0 | pass | pass |
| team-worker-delegated-task | astra-defaults | pass | — | 0 | 1600 | 2200/420 | 0 | pass | pass |
| team-worker-delegated-task | luna-uniform | pass | — | 0 | 1400 | 1900/380 | 0 | pass | pass |
| team-worker-delegated-task | mixed-luna-light-roles | pass | — | 0 | 1450 | 2050/400 | 0 | pass | pass |
| team-worker-delegated-task | terra-override | pass | — | 0 | 1550 | 2150/430 | 0 | pass | pass |
| team-worker-delegated-task | gpt-6.1-sol-candidate | pass | — | 0 | 1350 | 2250/460 | 0 | pass | pass |
| team-worker-delegated-task | gpt-6-sol-control | pass | — | 0 | 1480 | 2200/440 | 0 | pass | pass |
| sparkshell-failing-tests | astra-defaults | pass | — | 0 | unknown | 0/0 | 0 | pass | pass |
| sparkshell-failing-tests | luna-uniform | pass | — | 0 | unknown | 0/0 | 0 | pass | pass |
| sparkshell-failing-tests | mixed-luna-light-roles | pass | — | 0 | unknown | 0/0 | 0 | pass | pass |
| sparkshell-failing-tests | terra-override | pass | — | 0 | unknown | 0/0 | 0 | pass | pass |
| sparkshell-failing-tests | gpt-6.1-sol-candidate | pass | — | 0 | unknown | 0/0 | 0 | pass | pass |
| sparkshell-failing-tests | gpt-6-sol-control | pass | — | 0 | unknown | 0/0 | 0 | pass | pass |
| sparkshell-exit-status | astra-defaults | pass | — | 0 | unknown | 0/0 | 0 | pass | pass |
| sparkshell-exit-status | luna-uniform | pass | — | 0 | unknown | 0/0 | 0 | pass | pass |
| sparkshell-exit-status | mixed-luna-light-roles | pass | — | 0 | unknown | 0/0 | 0 | pass | pass |
| sparkshell-exit-status | terra-override | pass | — | 0 | unknown | 0/0 | 0 | pass | pass |
| sparkshell-exit-status | gpt-6.1-sol-candidate | pass | — | 0 | unknown | 0/0 | 0 | pass | pass |
| sparkshell-exit-status | gpt-6-sol-control | pass | — | 0 | unknown | 0/0 | 0 | pass | pass |
| sparkshell-exit-status | deterministic-no-model | pass | — | 0 | unknown | 0/0 | 0 | pass | unknown |
| sparkshell-failing-tests | deterministic-no-model | pass | — | 0 | unknown | 0/0 | 0 | pass | unknown |

## Aggregate per configuration
| config | declared pass | fail | error | difficult | retries | sum workflow elapsed ms | input/output | operator min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| astra-defaults | 6 | 0 | 0 | 0 | 0 | unknown | 12300/2490 | 1 |
| luna-uniform | 5 | 1 | 0 | 2 | 2 | unknown | 10300/1970 | 5 |
| mixed-luna-light-roles | 6 | 0 | 0 | 0 | 0 | unknown | 11200/2240 | 1 |
| terra-override | 6 | 0 | 0 | 0 | 0 | unknown | 12150/2410 | 1 |
| gpt-6.1-sol-candidate | 6 | 0 | 0 | 0 | 0 | unknown | 12550/2680 | 0 |
| gpt-6-sol-control | 6 | 0 | 0 | 0 | 0 | unknown | 12600/2570 | 1 |
| deterministic-no-model | 2 | 0 | 0 | 0 | 0 | unknown | 0/0 | 0 |

## Usage observations
Input/output are inclusive totals. Uncached input and cache reads partition input; cache writes are separate observations, never added to input. Reasoning is already in output.
| scope | input | output | uncached input | cache read | cache write | source | stage duration ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| explore-locate-stop-nudge @ astra-defaults: workflow (canonical) | 2400 | 480 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| explore-locate-stop-nudge @ luna-uniform: workflow (canonical) | 1800 | 320 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| explore-locate-stop-nudge @ mixed-luna-light-roles: workflow (canonical) | 1850 | 340 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| explore-locate-stop-nudge @ terra-override: workflow (canonical) | 2100 | 400 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| explore-locate-stop-nudge @ gpt-6.1-sol-candidate: workflow (canonical) | 2200 | 520 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| explore-locate-stop-nudge @ gpt-6-sol-control: workflow (canonical) | 2300 | 480 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| executor-bounded-change @ astra-defaults: workflow (canonical) | 4500 | 950 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| executor-bounded-change @ luna-uniform: workflow (canonical) | 3800 | 750 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| executor-bounded-change @ mixed-luna-light-roles: workflow (canonical) | 4200 | 880 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| executor-bounded-change @ terra-override: workflow (canonical) | 4600 | 920 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| executor-bounded-change @ gpt-6.1-sol-candidate: workflow (canonical) | 4700 | 1000 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| executor-bounded-change @ gpt-6-sol-control: workflow (canonical) | 4800 | 970 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| code-reviewer-known-defect @ astra-defaults: workflow (canonical) | 3200 | 640 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| code-reviewer-known-defect @ luna-uniform: workflow (canonical) | 2800 | 520 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| code-reviewer-known-defect @ mixed-luna-light-roles: workflow (canonical) | 3100 | 620 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| code-reviewer-known-defect @ terra-override: workflow (canonical) | 3300 | 660 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| code-reviewer-known-defect @ gpt-6.1-sol-candidate: workflow (canonical) | 3400 | 700 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| code-reviewer-known-defect @ gpt-6-sol-control: workflow (canonical) | 3300 | 680 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| team-worker-delegated-task @ astra-defaults: workflow (canonical) | 2200 | 420 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| team-worker-delegated-task @ luna-uniform: workflow (canonical) | 1900 | 380 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| team-worker-delegated-task @ mixed-luna-light-roles: workflow (canonical) | 2050 | 400 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| team-worker-delegated-task @ terra-override: workflow (canonical) | 2150 | 430 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| team-worker-delegated-task @ gpt-6.1-sol-candidate: workflow (canonical) | 2250 | 460 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| team-worker-delegated-task @ gpt-6-sol-control: workflow (canonical) | 2200 | 440 | 1 unknown | 1 unknown | 1 unknown | synthetic token counters | not-applicable |
| sparkshell-failing-tests @ astra-defaults: workflow (canonical) | 0 | 0 | 0 | 0 | 1 not-applicable | deterministic extractor; no model invoked | not-applicable |
| sparkshell-failing-tests @ luna-uniform: workflow (canonical) | 0 | 0 | 0 | 0 | 1 not-applicable | deterministic extractor; no model invoked | not-applicable |
| sparkshell-failing-tests @ mixed-luna-light-roles: workflow (canonical) | 0 | 0 | 0 | 0 | 1 not-applicable | deterministic extractor; no model invoked | not-applicable |
| sparkshell-failing-tests @ terra-override: workflow (canonical) | 0 | 0 | 0 | 0 | 1 not-applicable | deterministic extractor; no model invoked | not-applicable |
| sparkshell-failing-tests @ gpt-6.1-sol-candidate: workflow (canonical) | 0 | 0 | 0 | 0 | 1 not-applicable | deterministic extractor; no model invoked | not-applicable |
| sparkshell-failing-tests @ gpt-6-sol-control: workflow (canonical) | 0 | 0 | 0 | 0 | 1 not-applicable | deterministic extractor; no model invoked | not-applicable |
| sparkshell-exit-status @ astra-defaults: workflow (canonical) | 0 | 0 | 0 | 0 | 1 not-applicable | deterministic extractor; no model invoked | not-applicable |
| sparkshell-exit-status @ luna-uniform: workflow (canonical) | 0 | 0 | 0 | 0 | 1 not-applicable | deterministic extractor; no model invoked | not-applicable |
| sparkshell-exit-status @ mixed-luna-light-roles: workflow (canonical) | 0 | 0 | 0 | 0 | 1 not-applicable | deterministic extractor; no model invoked | not-applicable |
| sparkshell-exit-status @ terra-override: workflow (canonical) | 0 | 0 | 0 | 0 | 1 not-applicable | deterministic extractor; no model invoked | not-applicable |
| sparkshell-exit-status @ gpt-6.1-sol-candidate: workflow (canonical) | 0 | 0 | 0 | 0 | 1 not-applicable | deterministic extractor; no model invoked | not-applicable |
| sparkshell-exit-status @ gpt-6-sol-control: workflow (canonical) | 0 | 0 | 0 | 0 | 1 not-applicable | deterministic extractor; no model invoked | not-applicable |
| sparkshell-exit-status @ deterministic-no-model: workflow (canonical) | 0 | 0 | 0 | 0 | 1 not-applicable | deterministic extractor; no model invoked | not-applicable |
| sparkshell-failing-tests @ deterministic-no-model: workflow (canonical) | 0 | 0 | 0 | 0 | 1 not-applicable | deterministic extractor; no model invoked | not-applicable |
| astra-defaults: aggregate canonical usage | 12300 | 2490 | 0 known; 4 unknown | 0 known; 4 unknown | 4 unknown, 2 not-applicable | supplied records above | not-applicable |
| luna-uniform: aggregate canonical usage | 10300 | 1970 | 0 known; 4 unknown | 0 known; 4 unknown | 4 unknown, 2 not-applicable | supplied records above | not-applicable |
| mixed-luna-light-roles: aggregate canonical usage | 11200 | 2240 | 0 known; 4 unknown | 0 known; 4 unknown | 4 unknown, 2 not-applicable | supplied records above | not-applicable |
| terra-override: aggregate canonical usage | 12150 | 2410 | 0 known; 4 unknown | 0 known; 4 unknown | 4 unknown, 2 not-applicable | supplied records above | not-applicable |
| gpt-6.1-sol-candidate: aggregate canonical usage | 12550 | 2680 | 0 known; 4 unknown | 0 known; 4 unknown | 4 unknown, 2 not-applicable | supplied records above | not-applicable |
| gpt-6-sol-control: aggregate canonical usage | 12600 | 2570 | 0 known; 4 unknown | 0 known; 4 unknown | 4 unknown, 2 not-applicable | supplied records above | not-applicable |
| deterministic-no-model: aggregate canonical usage | 0 | 0 | 0 | 0 | 2 not-applicable | supplied records above | not-applicable |
Stage rows are not task outcomes. Stage durations are not workflow wall time; operator time is separate. Known sums exclude missing measurements.

## Failed and difficult cases (including unverified checks)
- `executor-bounded-change` @ `luna-uniform`: pass (difficult)
- `code-reviewer-known-defect` @ `luna-uniform`: fail (difficult) — finds-permanent-suppression: missing: suppression
  Required checks: fail; declared outcome is not verified completion.
- `sparkshell-exit-status` @ `deterministic-no-model`: pass
  Required checks: unknown; declared outcome is not verified completion.
- `sparkshell-failing-tests` @ `deterministic-no-model`: pass
  Required checks: unknown; declared outcome is not verified completion.

## Cost claims
Usage attribution is incomplete for: astra-defaults, luna-uniform, mixed-luna-light-roles, terra-override, gpt-6.1-sol-candidate, gpt-6-sol-control. No complete cost claim is made for those configurations.
A lower token count alone is not a successful result.
Declared pass counts and rates do not certify executed checks, independent review, or accepted completion. No model quality, cost, or savings conclusion is established by this report.

## Workload-weighted summary
Not reported: documented, representative task frequencies are missing for at least one evaluated fixture. Per-task results above stand on their own and imply no representative savings.

## Limitations
- Estimates (implementation/maintenance effort) are labeled separately from measurements.
- Identical reasoning-effort labels across models do not establish equivalent quality or cost.
- Codex-owned context, caching, and compaction behavior is not controlled by this suite; such fields are recorded as observed or `unknown`.
