# ludyRudy

Electron + SolidJS desktop manager for rclone. The renderer accesses the main process through the typed preload API. Keep daemon requests and secrets in the main process.

Use the sibling `solidjs-toolkit` checkout for linked packages; typecheck reads their source via the `cujuju-source` condition, so never build that shared checkout. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `env -u ELECTRON_RUN_AS_NODE pnpm smoke` before handoff. Smoke uses a disposable profile and a fake rclone daemon. Fetch the target's rclone release with `pnpm rclone:fetch [target|all]` before packaging. The fetch script uses `unzip` on macOS/Linux and the system `tar.exe` on Windows.

For local development with a running rclone daemon, pass `--rclone-endpoint=<url>` after `pnpm dev --`. Set `LUDYRUDY_RCLONE_AUTH` for authenticated attachment using the Basic authentication credential format. Authenticated non-loopback endpoints require HTTPS. Use `pnpm demo` for the isolated fixtures.

Track work in [Cujuju/ludyRudy Issues](https://github.com/Cujuju/ludyRudy/issues).

## Project review workflow

1. Record the app and toolkit commit IDs, target platform, runtime versions, and pinned rclone version. Install from the lockfiles in isolated checkouts. If smoke needs missing toolkit build artifacts, build the linked packages in the isolated toolkit checkout. Run the handoff checks above and record any pre-existing failures.
2. Trace each user action through the renderer, preload, IPC, service, and RC method. Cover managed and attached daemons, config changes, restarts, cancellation, partial completion, retries, stale responses, and platform path rules. Review settings and credential handling in main.
3. Check the actual RC response against the pinned rclone binary when a finding depends on its behavior. Use a disposable profile, config, and temporary local folders. Keep the fake-daemon smoke suite for renderer and IPC coverage.
4. Check keyboard focus, theme contrast, and feedback during busy or failed actions. Measure repeat work on large listings and during idle polling. For duplicated code, identify the shared behavior and test what existing callers rely on before proposing extraction.
5. Review development, packaging, release automation, and tests for setup assumptions and platform gaps. Compare fake responses with the real daemon for the contracts under review.
6. Verify each finding with a focused check or a complete source trace. Search existing issues and open pull requests. File one issue per independently actionable root cause with the impact, conditions, evidence, links pinned to the reviewed commit, and a regression check. Link the issues to the review and record what was untested.
