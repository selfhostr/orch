# Security policy

orch is for small teams who trust each other. The trust model, what the sandbox does and does not protect, and the access controls are described in [docs/security.md](docs/security.md); read it before reporting, because some behaviours (for example a task container having network access) are documented limits, not vulnerabilities.

## Supported versions

Only the latest `main` and the latest tagged release (`latest` image) are supported. Older tags: upgrade.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting: open the repository's **Security** tab, then **Report a vulnerability** (https://github.com/selfhostr/orch/security/advisories/new). Include the affected component (server, web, agent, installer), steps to reproduce or a proof of concept, the impact as you understand it, and the version or commit you tested.

A draft advisory lets us discuss and fix the problem privately before it is public. You will be credited in the advisory unless you prefer not to be.

## Notes

- Never commit `.env` files, tokens, GitHub App private keys or encryption keys. If you find any in the history, report it privately.
- Reports about the hosted instance are in scope as long as they concern orch itself, not third-party services.
