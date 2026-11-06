# Contributing to orch

Issues and pull requests are welcome on [GitHub](https://github.com/selfhostr/orch). Security problems go through [SECURITY.md](SECURITY.md), never a public issue. By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

Everything goes through Docker; the host needs only `docker` with Compose and `sh`. `./dev` is a thin wrapper around `docker compose -f compose.dev.yaml`. The repository is a pnpm TypeScript monorepo: `apps/web`, `apps/server`, `apps/agent`, `packages/shared`, plus `deploy/`, `docker/` and `install.sh`.

```sh
./dev install      # pnpm install inside the tools container
./dev up           # web + API: http://localhost:8470 (Caddy), http://localhost:8471 (API direct)
./dev down
```

The first run copies `.env.example` to `.env`. GitHub sign-in needs a development GitHub App; see the [development guide](docs/development.md) for the variables and the callback URL.

## Checks

A change must pass these, and CI runs the same:

```sh
./dev lint
./dev typecheck
./dev test
./dev test:install   # shellcheck + bats for install.sh, if you touched it
./dev test:ui        # Playwright browser tests, if you touched the web app
```

Add tests for any behaviour you change. A bug fix comes with a regression test that fails without the fix.

## Pull requests

- One branch and one pull request per logical change. Never push to `main` directly. Branches are named `feat/...`, `fix/...`, `docs/...` or `chore/...`.
- Titles and commits follow [Conventional Commits](https://www.conventionalcommits.org/), for example `fix(agent): retry a failed push`.
- Update the docs in `docs/` and `CHANGELOG.md` when behaviour or configuration changes.
- Applied database migrations are immutable: never edit or rename one. Give a new migration a timestamp later than the latest folder.
- User-visible text goes through the typed catalogs in `apps/web/src/i18n/` in English and French; `pnpm --filter @orch/web i18n:check` must pass.
- No secrets, tokens, private keys or `.env` files in the diff or the screenshots.

The [development guide](docs/development.md) covers migrations, the dev agent, CI, dependency updates, documentation and translations in detail.

## Developer Certificate of Origin

Every commit must be signed off to certify the [Developer Certificate of Origin](https://developercertificate.org/): commit with `git commit -s`, which adds a `Signed-off-by: Your Name <you@example.com>` line.

## Licence

By contributing you agree that your contribution is released under the [MIT licence](LICENSE).
