# Release 0.21.10 Inventory

Frozen range: `v0.21.9..72fee0236cf8a4b45e6dd9b3d826871f402b84ae` (16 commits, 7 merged PRs)

## Commits

```
72fee023 fix: preserve multi-line arrays in [tui] section during config merge (Fixes #3776) (#3777)
368f7100 Merge pull request #3775 from Yeachan-Heo/fix/astra-eval-results-3655
d6dcb722 perf: record corrected astra-defaults eval results
388d6de0 fix: correct Codex v0.162 JSONL parsing in collector
bae388ea perf: record astra-defaults eval results for #3655
e136aa5c Merge pull request #3774 from Yeachan-Heo/fix/red-ci
79af9226 fix: make collector hermetic and fix git clone in astra-defaults eval
b4db0393 fix: remove unused imports and update registry retry test for #3771 changes
37c4e2b8 fix(ci): extend npm registry-visibility check window and improve diagnostics (#3771)
9a7a89c0 fix(#3655): implement repository cloning and fixture context in collector (#3772)
8a9be1ca post-release: bump dev version to 0.21.10 (#3770)
90dd1fc8 fix(#3766): fix astra-defaults eval test failures and add to CI (#3768)
b3a547b9 Merge pull request #3769 from Yeachan-Heo/back-merge-0.21.9
01bb16c1 chore(release): back-merge v0.21.9 release to dev
d6796b54 feat(#3655): add base URL support to astra-defaults collector and record evaluation results (#3765)
ec3e87db feat: add evaluation harness for Astra/Luna/GPT-6.1 Sol cost+quality via Layofflabs (#3765)
```

## Merged PRs

| Number | Author | Title |
|--------|--------|-------|
| [#3765](https://github.com/Yeachan-Heo/oh-my-codex/pull/3765) | @Yeachan-Heo | feat(#3655): add base URL support to astra-defaults collector and record evaluation results |
| [#3768](https://github.com/Yeachan-Heo/oh-my-codex/pull/3768) | @Yeachan-Heo | fix(#3766): fix astra-defaults eval test failures and add to CI |
| [#3771](https://github.com/Yeachan-Heo/oh-my-codex/pull/3771) | @Yeachan-Heo | fix(ci): extend npm registry-visibility check window and improve diagnostics |
| [#3772](https://github.com/Yeachan-Heo/oh-my-codex/pull/3772) | @Yeachan-Heo | fix(#3655): implement repository cloning and fixture context in collector |
| [#3774](https://github.com/Yeachan-Heo/oh-my-codex/pull/3774) | @Yeachan-Heo | fix: remove unused imports and update registry retry test for #3771 changes |
| [#3775](https://github.com/Yeachan-Heo/oh-my-codex/pull/3775) | @Yeachan-Heo | perf: record astra-defaults eval results for #3655 |
| [#3777](https://github.com/Yeachan-Heo/oh-my-codex/pull/3777) | @Yeachan-Heo | fix: preserve multi-line arrays in [tui] section during config merge |

## Issues addressed

- #3655: Astra-defaults evaluation infrastructure
- #3766: astra-defaults eval test failures
- #3776: multi-line array preservation in TOML config merge

