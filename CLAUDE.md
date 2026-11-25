# ludyRudy

Electron + SolidJS desktop manager for rclone. The renderer accesses the main process through the typed preload API. Keep daemon requests and secrets in the main process.

Use the sibling `solidjs-toolkit` checkout for linked packages; typecheck reads their source via the `cujuju-source` condition, so never build that shared checkout. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `env -u ELECTRON_RUN_AS_NODE pnpm smoke` before handoff. Smoke uses a disposable profile and a fake rclone daemon. Fetch the target's rclone release with `pnpm rclone:fetch [target|all]` before packaging. The fetch script uses `unzip` on macOS/Linux and the system `tar.exe` on Windows.

For local development with a running rclone daemon, pass `--rclone-endpoint=<url>` and, when needed, `--rclone-auth=<user:pass>` after `pnpm dev --`. Use `pnpm demo` for the isolated fixtures.

Track work in [Cujuju/ludyRudy Issues](https://github.com/Cujuju/ludyRudy/issues).
