<div align="center">
<a href="https://orch.selfhostr.io"><img src=".github/assets/banner.svg" alt="orch: A shared to-do list that turns into pull requests." width="100%"></a>

**A shared to-do list for small, trusted teams, run on each member's own Claude subscription.**

[Site](https://orch.selfhostr.io) · [Docs](https://orch.selfhostr.io/docs/) · [Demo](https://orch.selfhostr.io/demo/) · [Changelog](CHANGELOG.md)

[![CI](https://github.com/selfhostr/orch/actions/workflows/ci.yml/badge.svg)](https://github.com/selfhostr/orch/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
</div>

## Overview

Tasks are GitHub issues. A member, or Claude Code through MCP, adds them to a shared pool. Each task then runs on a teammate's own machine, with their own Claude subscription, in a throwaway container that only sees its own git clone, and `orch` pushes a branch and opens a PR. Free, for good: MIT licence, no paid edition.

## Quick start

Server admin, once (Linux host, Docker 26+ with Compose, ports 80 and 443, a DNS name):

```sh
git clone https://github.com/selfhostr/orch.git && cd orch/deploy/server
cp .env.example .env     # fill it in, then create the GitHub App
docker compose up -d
```

Each member then runs the one-time command (valid 15 minutes) from **My Server** in the web UI:

```sh
curl -fsSL https://<domain>/install.sh | ORCH_TOKEN=<one-time-token> sh
orch login
```

Sign in at `https://<domain>`. Back up the database dumps **and** keep `.env` (notably `ORCH_ENCRYPTION_KEY`) and the GitHub App private key elsewhere: they are not in the dump. Full steps: [quick start](https://orch.selfhostr.io/docs/quickstart/), [installation](https://orch.selfhostr.io/docs/installation/).

## Features

- **No pooled accounts.** The server never sees Claude credentials; member machines connect out over a WebSocket, so no inbound ports.
- **Pool and Backlog.** Issues with the project's pool label become tasks; budgets are estimates.
- **Auto or approval.** In `AUTO` the agent runs a task headlessly and the PR opens as a draft; in `APPROVAL` nothing starts until the member accepts.
- **Manual mode.** `orch take <n>`, `orch attach <n>`, `orch done <n>` in a `screen` session.
- **Claude Code over MCP.** Submit and inspect tasks with MCP OAuth 2.1 or personal access tokens.
- **Access control.** Admins, allowlists of logins or organizations, access requests, invite links.
- **Notifications and observability.** In-app, browser, e-mail and webhook notifications; Prometheus metrics and OpenTelemetry traces.
- **Backups.** Scheduled `pg_dump` with rotation, optional age encryption and S3 upload.

## Architecture

Caddy (automatic HTTPS, static web build) fronts a Fastify server with Postgres; scheduled dumps run in a `backup` service. Each member runs an agent container that drives their local Docker and starts one non-root task container per task, with only its clone mounted. See [concepts](https://orch.selfhostr.io/docs/concepts/).

## Limits

- For small teams who trust each other: anyone who can get an issue labeled for the pool can write a prompt that runs on a teammate's machine. Do not use it with strangers or public repos.
- In auto mode the task container runs with `bypassPermissions`, network access and the member's Claude token, with no egress filtering.
- The agent is root-equivalent on the member's host (it mounts `/var/run/docker.sock`); rootless Docker reduces this.
- Single server instance by default; usage and budget are estimates. GitHub only, English UI only.
- The agent image installs Claude Code, which is proprietary software from Anthropic and is subject to Anthropic's terms; orch itself is MIT-licensed.
- Releases are `0.x`: anything may change between minor versions. See the [security model](https://orch.selfhostr.io/docs/security/).

## Contributing

Issues and pull requests are welcome: [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

## License

MIT, see [LICENSE](LICENSE). Provided "as is", without warranty of any kind.

## Support

orch is free and has no company behind it. If it saves you time: [sponsor us on GitHub](https://github.com/sponsors/selfhostr).
