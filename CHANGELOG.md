# Changelog

All notable changes to orch. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions are `0.MINOR.PATCH` until 1.0. The full notes of each release are on the [releases page](https://github.com/selfhostr/orch/releases).

## Unreleased

### Added

- A CI job fails when a dependency (dev tools included) has no OSI-approved licence (`pnpm run check:licences`).
- The README states that the agent image installs Claude Code, which is proprietary software from Anthropic, and that orch itself is MIT.
- The maintenance leader now deletes old rows in bounded batches: audit entries (`RETENTION_AUDIT_DAYS`, 365), webhook delivery ids (`RETENTION_WEBHOOK_DAYS`, 30), offers that never started (`RETENTION_ASSIGNMENT_DAYS`, 90), and sessions and enrollment tokens expired for `RETENTION_EXPIRED_DAYS` (7). 0 keeps a table forever. The audit log keeps its trigger: rows younger than 30 days cannot be deleted or modified, whatever the retention setting, and TRUNCATE is refused. Older rows can be deleted, normally by the retention purge (`audit_log_purge()`); the table owner can still disable triggers. `RETENTION_AUDIT_DAYS` must be 0 or at least 30. The migration builds indexes on `AuditLog`, `Session`, `EnrollmentToken` and `Assignment`, which can take a few seconds on a large audit log (writes to the table wait meanwhile). Purged rows are counted by `orch_retention_purged_rows_total{table}`.

### Changed

- The interface uses Inter and JetBrains Mono (both OFL-1.1, self-hosted through fontsource) instead of Overpass and Overpass Mono.

### Security

- Avatars are served and cached by the orch server (`/api/avatars/...`, only from GitHub's avatar host, size-limited, with a timeout) instead of being loaded by the browser from `avatars.githubusercontent.com`: GitHub's CDN no longer sees your visitors' IP addresses. The production CSP is now `img-src 'self' data:`.

## 0.9.1 - 2026-11-04

### Changed

- The project is now simply orch and lives at `github.com/selfhostr/orch`. Documentation: <https://orch.selfhostr.io/docs/>.
- Releases are published only as `ghcr.io/selfhostr/orch-server`, `ghcr.io/selfhostr/orch-web` and `ghcr.io/selfhostr/orch-agent`. `ghcr.io/theroxat/orch-*` gets no new releases. `deploy/server/compose.yaml` uses the new names. If your server `.env` pins `ORCH_VERSION` to an old release, set it to `0.9.1`, and remove any `ORCH_AGENT_IMAGE_REPO=ghcr.io/theroxat/orch-agent` override.
- Agents installed with 0.9.0 or older only accept updates from `ghcr.io/theroxat/orch-agent`: switch the image once on the agent's machine (see the release notes), then one-click update works again.

### Fixed

- Renamed or transferred repositories stay linked: the `repository renamed/transferred`, `installation created` and `repositories added` webhooks update the project's stored full name and installation, and restore a project that was archived after a lost access (#75).

## 0.9.0 - 2026-10-26

### Security

- Compose guard completed (agent): strict allowlists on every key of the resolved `docker compose config` model, hardened sidecars (`cap_drop: ALL`, `no-new-privileges`, CPU, memory and PID limits, no published ports or fixed container names) and a corpus of real compose files. It also closes a host escape through writable binds of a directory that another sidecar mounts; such binds are now refused. Repositories that used a refused feature have to adapt their compose files (#71).
- Private repository access is re-checked: every view and action on a private repository asks GitHub whether the user still has a role on it. Answers are cached and invalidated by webhooks. During a GitHub outage the last verified role is kept for a grace window, then access is denied (#67).
- Stronger secret redaction: one shared module masks secrets in live logs, the local run log, failure messages and notifications, in the common encodings of every value the agent knows for a run (#72).
- Generic JSON webhooks are signed according to Standard Webhooks. A secret is generated or rotated in the notification settings and shown once; during a rotation the previous secret also signs for 24 hours (#70).

### Added

- Several server instances behind a load balancer, with Postgres as the only shared component: elected leader for the dispatcher and the maintenance jobs, agent messages relayed between instances, a durable notification queue, shared `auth` and `agent-connect` rate limits (#68).
- English and French interface, with a CI check that keeps the two locales in sync (#69).
- Faster history search: trigram index on task titles and indexes on issue and PR numbers (#73).
- Landing site in `site/` (#66).
- New optional settings: `ORCH_REPO_ACCESS_TTL_SEC`, `ORCH_REPO_ACCESS_GRACE_SEC`, `NOTIFY_QUEUE_POLL_MS`, `ORCH_INSTANCE_ID`, `ORCH_CLUSTER_NAME`, `ORCH_INSTANCE_HEARTBEAT_MS`, `ORCH_LEADER_RETRY_MS`. The defaults suit a single instance.

## 0.8.1 - 2026-10-24

### Changed

- Notification e-mails only go to an address the member has confirmed through a single-use link valid 24 hours. Addresses saved before this release are pending until the member presses Resend confirmation in the notification settings (#62).
- Metrics: `prom-client` replaced by `@prometheus-io/client`; existing `/metrics` series are unchanged and two event-loop utilization series are added (#61).

### Fixed

- The welcome wizard moves focus to the step title as soon as the step is shown (#63).

## 0.8.0 - 2026-10-23

### Added

- Live task logs in the web UI, streamed from the agent (#48).
- Notifications: in-app bell plus Slack, Discord, generic webhook and e-mail channels, with per-event preferences (#49).
- Web Push notifications (#58) and an installable app (PWA) with an offline page (#54).
- Usage page: weighted tokens, runs, success rate and project budgets over 7, 30 and 90 days (#50).
- Task history with search, filters and pagination (#51), and task templates with `{{placeholders}}` (#60).
- Observability: Prometheus `/metrics`, `/readyz`, optional OpenTelemetry traces and a Prometheus and Grafana stack in `deploy/observability` (#53).
- Scheduled backups with rotation, optional age encryption, S3-compatible upload and `backup/restore.sh` (#52).
- Rate limiting on every route family, with `429` and `Retry-After` (#55).

### Changed

- Server image down from 904 MB to about 384 MB (#59).
- The dispatcher loads one snapshot per tick instead of queries per task and member (#56).

## 0.7.0 - 2026-10-22

### Added

- Documentation: quickstart, installation, concepts, CLI and MCP reference, configuration, security model and FAQ, built in CI with warnings as errors (#36).
- Documentation and GitHub links in the web UI header (#44).

### Changed

- New indexes for the dispatcher hot paths (additive migration), and `GET /api/tasks` runs one query for every visible project (#41).
- Agent image: multi-stage build (#40).

## 0.6.1 - 2026-10-21

### Fixed

- No more CSP `script-src eval` violation on every page load.
- OAuth consent: a double click on Approve sends a single request.
- Backlog: Retry only appears on tasks that failed since the last retry or need attention; the board fits at 1280px without horizontal scroll.
- Unknown URLs show a "Page not found" page; the welcome wizard has a Log out link; the pool lists each member's machines.
- Colour contrast fixes in both themes.

### Added

- A Playwright browser test suite (`./dev test:ui`), run in CI.

## 0.6.0 - 2026-10-21

### Added

- Owners can join their own pool, with a budget percentage and a mode (#34).
- Owners can give a reason when rejecting a member, and undo a rejection (#34).

### Changed

- New "signal board" design for the whole web app, with self-hosted fonts (#22).
- Dependency upgrade: React 19, Vite 8, Zod 4, Prisma 7, pnpm 12 and Node 24 (#5).

### Fixed

- `/backlog?task=<id>` highlights the linked task (#24); removing a project refreshes the list of added repositories (#26); signing in returns to the requested page (#27); the Access page clears an old error after a success (#28).
- The audit action `participation.rejectd` is now `participation.rejected`.

## 0.5.2 - 2026-10-21

### Fixed

- `orch login` could save a token that had silently lost characters, so every run failed with a 401. It now reads the token from a terminal emulation, checks its shape, falls back to a hidden paste, and verifies it with a real Claude call (#33).

### Added

- `orch doctor` shows the Claude binary and version and whether the token is present and valid.
- The agent re-checks the token whenever the token file changes and reports the result to the server, which only clears the "Claude login invalid" flag after a successful check or run.

### Security

- `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` and the provider switches are blanked in the task sandbox.

## 0.5.1 - 2026-10-21

### Fixed

- Stuck backlog: the agent classifies failures as `env`, `claude_auth`, `rate_limited`, `timeout` or `task`, and only `task` and `timeout` count toward the 24 hour shut-out (#32).
- Several agent and participation races (#15, #16, #17, #19, #21, #25).

### Added

- Backlog cards show the last error and a Retry button, also available as `POST /api/tasks/:id/retry` and the MCP tool `retry_task`, plus a "Why isn't this running?" panel.

## 0.5.0 - 2026-10-21

### Added

- One-click agent update from the web app (#18).

### Security

- Hardened task sandbox: the compose guard accepts only allowlisted keys, uses a real YAML parser, refuses `provider`, privileged hooks, `use_api_socket`, `gpus`, foreign networks, volume and network driver options and local build caches, checks every symlink in the committed tree and pauses the compose project before a commit (#23).

### Fixed

- The `env_file` override applies to every compose call (#20); a connected agent loses access when its owner's access is removed (#7); a failed `orch done` keeps the `.git` of a manual session (#11); the OAuth consent page can no longer be submitted twice (#13).
