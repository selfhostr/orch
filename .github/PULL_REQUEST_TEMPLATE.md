<!-- One topic per PR. Title in Conventional Commits form: feat(scope): ..., fix(scope): ..., docs: ... -->

## What

<!-- One or two sentences: what changes and why. Link the issue if there is one: Closes #123 -->

## How

<!-- Anything a reviewer needs to know: design choices, alternatives rejected, follow-ups left out. -->

## Screenshots

<!-- Required for UI changes: before/after, light and dark. Delete this section otherwise. -->

## Checklist

- [ ] `./dev lint`, `./dev typecheck` and `./dev test` pass
- [ ] New functionality and bug fixes come with tests (a bug fix with a regression test that fails without the fix)
- [ ] `./dev test:ui` passes (if the web app changed) and `./dev test:install` (if `install.sh` changed)
- [ ] New or changed strings exist in English and French and `i18n:check` passes
- [ ] New migration has a unique timestamp later than the latest one, and no applied migration was edited
- [ ] Docs in `docs/` and `CHANGELOG.md` updated when behaviour or configuration changes
- [ ] No secret, token or `.env` file in the diff or the screenshots
