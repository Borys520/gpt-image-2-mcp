# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Unit tests (`tests/*.test.ts`) covering the pure utilities: size validator,
  cost estimator, filename builder, and output-dir path guard. Run with
  `pnpm run test`.
- GitHub Actions CI workflow (`.github/workflows/ci.yml`) — typecheck, build,
  and test on Node 20 and 22 for every push and PR on `main`.
- Output schemas on every tool, so MCP clients can validate
  `structuredContent` and introspect each result's shape.
- `OPENAI_USE_DIRECT_EDITS=1` env var to route edits through the canonical
  `/v1/images/edits` endpoint instead of the Responses-API workaround —
  useful for testing once OpenAI fixes that endpoint's gpt-image-2 support.
- Session TTL + LRU cap for `start/continue_edit_session`, configurable via
  `GPT_IMAGE_2_SESSION_MAX` (default 20) and `GPT_IMAGE_2_SESSION_TTL_MS`
  (default 1 hour). Prevents unbounded memory growth on long-lived servers.
- `output_dir` path-traversal guard that rejects a denylist of OS-sensitive
  directories (`/etc`, `/System`, `~/.ssh`, etc.). Override with
  `GPT_IMAGE_2_ALLOW_UNSAFE_OUTPUT_DIR=1`.
- `.env.example` documenting every supported environment variable.
- `CHANGELOG.md`.

### Changed

- `loadImage` now enforces a 15-second fetch timeout, a `Content-Length`
  pre-check, and a streaming size cap so a slow, lying, or missing-length
  remote response cannot OOM the server or enable SSRF against internal
  hosts.
- Pinned `@modelcontextprotocol/sdk` to `^1.29.0` and `openai` to `^6.34.0`
  (from unbounded `^1.0.0`/`^6.0.0`) so future major/minor bumps don't
  silently reach published installs.
- `continue_edit_session` uses the return value of `updateSession()`
  explicitly instead of relying on in-place mutation of the cached session
  reference.
- Replaced `as never` casts in the Responses-API edit path with proper
  typed SDK shapes (`ResponseInputItem`, `Tool`).
- `src/server.ts` reads `name` and `version` from `package.json` at
  startup instead of hardcoding them.
- `src/utils/file-input.ts` uses Node's built-in `url.fileURLToPath` for
  robust `file://` handling on Windows.
- Shared `toolError` helper replaces three copy-pasted implementations.

### Fixed

- Inconsistency where `edit_image`'s schema accepted `quality: "standard"`
  even though the Responses-API route can't forward it. The value is no
  longer accepted.

## [0.1.0] — 2026-04-22

### Added

- Initial release. MCP server wrapping OpenAI's gpt-image-2 with six tools:
  `generate_image`, `edit_image`, and `start/continue/end/list_edit_sessions`.
