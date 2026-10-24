# oh-my-codex 0.21.35

`0.21.35` is a patch release that fixes legacy recovery journal ownership and platform-aware replay logic.

This release addresses issues introduced in v0.21.34's shutdown preservation (#3896) where legacy recovery journals from other workers could block a healthy worker's shutdown. The fix scopes journal recovery to the owning worktree and enforces platform-aware naming conventions, preventing parent traversal attempts and ensuring module-only replay.

## Highlights

- **RESILIENCE: Worktree-scoped journal recovery (#3903):** A pending legacy (array-format) recovery journal owned by another worker no longer blocks a healthy worker's shutdown with `shutdown_worktree_preservation_failed`. This fixes a regression introduced by v0.21.34's shutdown preservation (#3896).
- **SAFETY: Platform-aware legacy journal ownership (#3904):** Legacy journal names beginning with `".."` are no longer treated as parent traversal attempts. Platform-aware ownership checking prevents cross-worker journal contamination.
- **MODULE ISOLATION: Modules-only replay (#3904):** Legacy journal replay is now enforced to operate only on modules, preventing accidental state corruption from misconfigured legacy journals.

## Compatibility

- No breaking API changes; recovery robustness improvements only.
- **Team runtime users:** If you experienced recovery journal blocking on shutdown in v0.21.34, this release resolves the issue.
- Existing sessions with pending legacy recovery journals will be handled correctly by the platform-aware logic.
- The fix improves legacy recovery robustness without changing the recovery API contract.

## Known issues

- #3898 (live-pin fix) is in progress (#3900); `Codex 0.164.0` hook validation was invalidated by `.omx-live-pin` files in the plugin cache. Workaround: manually clear `.omx-live-pin` from the cache if running Codex 0.164.0.

## Validation

- Pinned candidate `c6a41e75a04a77c7507b5987246abad80029ac9a` passed CI run at 02:17Z on 2026-10-24: 17 checks succeeded, 8 conditional checks skipped, no failures.
- Both macOS Ralplan preflight security jobs PASSED (not cancelled or failed).
- All local gates pass: build, typecheck, lint, and team runtime legacy recovery tests.
- All code review findings addressed.
- Ready for merge and release.

## Merged PR inventory

| PR | Author | Title |
|---|---|---|
| [#3903](https://github.com/Yeachan-Heo/oh-my-codex/pull/3903) | @shenyankm | fix(team): scope legacy recovery journals to the owning worktree |
| [#3904](https://github.com/Yeachan-Heo/oh-my-codex/pull/3904) | @Claude Code | fix(team): platform-aware legacy journal ownership and modules-only replay |

## Contributors

Thanks to @shenyankm for the legacy journal fix, and @Claude Code for platform-aware ownership and Codex resolution.

**Full Changelog**: [`v0.21.34...v0.21.35`](https://github.com/Yeachan-Heo/oh-my-codex/compare/v0.21.34...v0.21.35)

—
*[repo owner's gaebal-gajae (clawdbot) 🦞]*
