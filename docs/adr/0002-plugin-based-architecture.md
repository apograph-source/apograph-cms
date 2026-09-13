# 0002 — Plugin-based architecture

- **Status:** Accepted
- **Date:** 2026-06-18
- **Deciders:** Engineering

> Documents a decision already embodied in the codebase, recorded
> retrospectively so the rationale is explicit.

## Context

Apograph must grow many capabilities (auth, users, workspaces, activity, and
eventually content/AI) across two runtimes (a React admin SPA and a NestJS API)
without the hosts accumulating domain logic or features becoming entangled.

## Decision

We will keep the application **hosts** (`@apograph/bootstrap-admin`,
`@apograph/bootstrap-server`) free of domain logic. Each host turns a _list of
plugins_ into a running app. Capability lives in plugins, usually shipped as an
`admin`/`server` pair under `packages/<group>/{admin,server}`. Server plugins own
their own Drizzle schema and migrations; the shared `@apograph/database` plugin
owns the single connection but no schema _(amended below — it owns the outbox
table)_. Plugins integrate through explicit contracts (`AdminPlugin`,
`ServerPlugin`) and named UI **slots**, never by reaching into each other.

> **Amended by [ADR-0003](0003-tactical-ddd-inside-plugins.md).** "No schema" now
> has exactly one sanctioned exception: the transactional outbox
> (`outbox_events`), which `@apograph/database` owns and migrates because the
> `UnitOfWork` that writes it lives there too — an event has to commit in the
> same transaction as the change that raised it, so the table cannot belong to
> any one domain plugin. It remains the only table in this package, and adding a
> second would be a new decision, not a detail.

## Consequences

- Adding capability never requires editing a host — register a plugin in
  `apps/admin/src/main.tsx` / `apps/server/src/plugins.ts`.
- Clear ownership boundaries; per-plugin schema/migrations keep domains isolated.
- Authoring conventions must be encoded and enforced (hence the `server-plugin`
  and `admin-plugin` skills) so plugins stay consistent.
- Cross-cutting concerns (auth guard, validation, DB connection) are provided
  globally by the host/database plugin rather than re-implemented per plugin.

## Alternatives considered

- **A conventional layered monolith** — simpler initially, but couples features
  and concentrates change in shared modules.
- **Separate repos/services per domain** — too much operational overhead for the
  current stage; the monorepo + plugin model gives isolation without it.
