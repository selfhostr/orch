# Connect Claude Code (MCP)

orch exposes an MCP server so Claude Code can see the pool and submit work. The server needs no LLM key: your own Claude Code does the planning.

## Setup

1. Add the server to Claude Code (no token to copy):

   ```sh
   claude mcp add --transport http --scope user orch https://<domain>/mcp
   ```

2. In Claude Code, run `/mcp`, choose **orch**, then **Authenticate**.
3. Your browser opens: sign in with GitHub (the same orch login and allowlist) and approve. Done.

The **Claude Code** page of the web UI shows the command pre-filled with your domain and lists the connected apps, each with a **Revoke** button.

Under the hood this is MCP OAuth 2.1: discovery (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`), dynamic client registration, the authorization code flow with PKCE (S256), access tokens (`orch_oat_...`, 1 hour) bound to `https://<domain>/mcp`, and rotating refresh tokens. Everything is stored hashed and audited. A member removed from the allowlist loses every token.

(mcp-redirect-hosts)=

### Allowed redirect addresses

After approval the browser, with the authorization code, goes back to the client's `redirect_uri`. orch accepts only two kinds:

- loopback `http` on any port: `127.0.0.1`, `[::1]` and `localhost` (RFC 8252). This is what Claude Code uses;
- `https` on a host listed in `ORCH_OAUTH_REDIRECT_HOSTS` (comma-separated, default `claude.ai,claude.com` for the Claude web connectors). The host must match exactly: `evil.claude.ai` or `claude.ai.example.org` do not match `claude.ai`. Add `:port` for a non-standard port (`:443` is the default and is ignored). Set it to `none` to allow no https host, loopback only.

Registration with any other address is refused, and the rule is checked again at every authorization and token request: if you remove a host from the list, its clients can no longer authorize, exchange a code or refresh. Access tokens they already hold keep working until they expire, at most 1 hour later; revoke them on the **Claude Code** page to cut them off at once. An invalid authorization request whose address is not allowed shows an error page and is never redirected. The consent page shows the redirect host: deny if it is not the one you expect.

## Personal access tokens (scripts and CI)

Create a personal access token on the **Claude Code** page (shown once, hashed, revocable) and send it as a header:

```sh
claude mcp add --transport http --scope user orch https://<domain>/mcp \
  --header "Authorization: Bearer <orch_pat_token>"
```

## Tools

| Tool             | Purpose                                                    |
| ---------------- | ---------------------------------------------------------- |
| `view_pool`      | Who has capacity right now                                 |
| `list_tasks`     | Tasks of a project                                         |
| `submit_task`    | Atomic batch of tasks with dependencies; supports dry runs |
| `list_templates` | Task templates you can use (built-in, personal, project)   |
| `take_task`      | Claim a task (same checks as `orch take`)                  |
| `task_status`    | Status of a task                                           |
| `retry_task`     | Offer a task again after failed runs (owner or creator)    |

## Task templates

`list_templates` returns the templates available to you: the built-ins (_Fix a bug_, _Upgrade a dependency_, _Add tests_, _Refactor module_), your personal ones and, when you pass `projectFullName`, the ones shared by that project. Each entry has an `id`, its `placeholders`, and its default size, model, labels and acceptance criteria.

`submit_task` accepts, per subtask, an optional `template` (an `id` or an exact name) and `variables` (an object with one value per placeholder):

```json
{
  "projectFullName": "acme/webapp",
  "tasks": [
    {
      "ref": "a",
      "template": "Upgrade a dependency",
      "variables": { "package": "zod", "version": "4.6.7", "notes": "Check the error format." }
    }
  ]
}
```

The title, description, acceptance criteria, size, model and labels are rendered from the template; fields you set yourself (`title`, `size`, `model`, `description`, `acceptanceCriteria`) win. Without `template`, `title`, `description`, `acceptanceCriteria`, `size` and `model` are required, as before. Every placeholder needs a non-empty value: a missing or unknown variable fails the whole request (`missing_variables`, `unknown_variables`) and nothing is created. A template you cannot see (someone else's personal template, a private project) is reported as not found.

## Example prompts

- "Use orch to show who in the pool has capacity right now."
- "Read this repo, split the work to add CSV export into small tasks with acceptance criteria, and submit them to `acme/webapp` through orch. Dry run first."
- "List my open orch tasks for `acme/webapp` and tell me which ones are blocked."
- "Use orch to upgrade `zod` to 4.6.7 in `acme/webapp` with the built-in dependency template."
- "What is the status of issue 42 in `acme/webapp`?"
