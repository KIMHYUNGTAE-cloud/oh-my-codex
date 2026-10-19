# oh-my-codex 0.21.19

`0.21.19` is a patch release for agent model configuration and third-party provider fixes with correctness improvements for profile-scoped model resolution and provider classification (19 commits, 16 files, +925/−41; PRs #3824, #3825, #3827, #3828, #3829, #3831, #3832).

## Highlights

- **Third-party provider model pins (#3824, fixing #3823):** stop baking `exactModel` pins for agents using third-party providers, allowing providers to rotate their default models while keeping agents resolvable. Reported by @hetingyi.
- **Runtime-inherited model detection (#3825, fixing #3822):** align `omx doctor` spark-lane model checks with runtime-inherited agent model behavior, eliminating false positives that `omx setup --force` could never clear. Reported by @hetingyi.
- **Profile-scoped model overrides (#3827):** honor profile-scoped agent model settings and override guidance in generated agent runtime config.
- **Effective profile model resolution (#3831):** resolve active profile models before built-in fallbacks, keep exact pins when built-in providers omit models, and avoid claiming fallback models for provider-only configs.
- **Final readiness poll (#3829):** always perform final team readiness poll before the timeout deadline.

## Compatibility

- Agent generation and setup now correctly handle third-party provider model changes without requiring reinstallation.
- Doctor diagnostics no longer report valid runtime-inherited configurations as stale.
- Profile-scoped model overrides are now applied to all agents, not just those with explicit pin overrides.
- Built-in provider model resolution now correctly reflects configured models across generation, pinning, and metadata.

## Validation

- Pinned candidate `987f4b0d73f1f6c369ad24758c31197412dc3451` passed latest-per-name dev CI: 17 checks succeeded and 8 conditional checks were skipped, with no failures.
- Release branch CI passed with all required checks green after rerunning known flakes (macOS Ralplan preflight at 30m timeout).
- All Codex review findings resolved across release branch and dev merge.

## Merged PR inventory

| PR | Author | Title |
|---|---|---|
| [#3824](https://github.com/Yeachan-Heo/oh-my-codex/pull/3824) | @Yeachan-Heo | fix(agents): don't bake exactModel pins for third-party providers |
| [#3825](https://github.com/Yeachan-Heo/oh-my-codex/pull/3825) | @Yeachan-Heo | fix(doctor): align spark-lane model check with runtime-inherited agents |
| [#3827](https://github.com/Yeachan-Heo/oh-my-codex/pull/3827) | @Yeachan-Heo | fix(agents): honor profile-scoped models and override guidance |
| [#3828](https://github.com/Yeachan-Heo/oh-my-codex/pull/3828) | @Yeachan-Heo | test(team): make MDM-marker readiness termination deterministic |
| [#3829](https://github.com/Yeachan-Heo/oh-my-codex/pull/3829) | @Yeachan-Heo | fix(team): always take a final readiness poll before the deadline |
| [#3831](https://github.com/Yeachan-Heo/oh-my-codex/pull/3831) | @Yeachan-Heo | fix(agents): resolve the effective profile model for pins, metadata and guidance |

Issues #3822 and #3823 were reported by @hetingyi.

## Contributors

Thanks to @Yeachan-Heo for the fixes and @hetingyi for reporting the issues.

**Full Changelog**: [`v0.21.18...v0.21.19`](https://github.com/Yeachan-Heo/oh-my-codex/compare/v0.21.18...v0.21.19)

—
*[repo owner's gaebal-gajae (clawdbot) 🦞]*
