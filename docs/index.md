# orch

```{image} screenshot-backlog.png
:alt: The Backlog: tasks by status, each one a GitHub issue
:width: 100%
```

orch is a shared to-do list for teams who trust each other, with automation on top.

- Tasks are GitHub issues. A team member (or Claude Code, through MCP) adds them to a shared pool.
- Each member runs tasks **on their own machine, with their own Claude subscription**. Nothing is pooled across accounts.
- A task runs in a throwaway container that only sees its own git clone, then orch pushes a branch and opens a PR.
- The central server only sees usage estimates and task statuses, never Claude credentials.
- Everything runs in Docker: server, web, database, proxy, member agent, task sandboxes and all development workflows.

```{mermaid}
flowchart TB
    GH["GitHub App<br/>OAuth, webhooks, issues, PRs"]
    subgraph Server["Your server (Docker Compose)"]
        Caddy["Caddy<br/>HTTPS, web build, proxy"] --> API["server (Fastify)<br/>API, dispatcher, MCP, agent gateway"]
        API --> PG[("Postgres<br/>+ scheduled pg_dump")]
    end
    Browser["Browser"] -->|HTTPS| Caddy
    CC["Claude Code"] -->|"/mcp"| Caddy
    GH <-->|"REST, webhooks"| API
    subgraph Member["Member machine (any Docker host)"]
        Agent["agent container<br/>orch CLI, mirrors, clones"] --> Task["task container<br/>only the clone, non-root, claude"]
    end
    Agent -->|"outbound WebSocket /agent/ws"| Caddy
```

Members never open an inbound port: the agent connects out to the server over a WebSocket.

Start with the {doc}`quickstart`, the full {doc}`installation`, or the {doc}`concepts` behind the pool.

```{toctree}
:maxdepth: 2
:caption: Get started

quickstart
installation
github-app
members
backups
```

```{toctree}
:maxdepth: 2
:caption: Using it

concepts
usage
notifications
mcp
```

```{toctree}
:maxdepth: 2
:caption: Reference

configuration
cli
observability
```

```{toctree}
:maxdepth: 2
:caption: Security

security
```

```{toctree}
:maxdepth: 2
:caption: Operations

faq
```

```{toctree}
:maxdepth: 2
:caption: Development

development
```
