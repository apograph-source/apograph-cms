# 0003 — Tactical DDD inside plugins

- **Status:** Accepted <!-- the workspaces pilot (Wave 1) merged: packages/workspaces/{server,admin} are the reference layout -->
- **Date:** 2026-07-17
- **Deciders:** Engineering

> Builds on [ADR-0002](0002-plugin-based-architecture.md), which established the
> *strategic* structure (plugins as bounded contexts, integration through
> explicit contracts and slots). This ADR adds the *tactical* structure **inside**
> each context. It does not supersede 0002 — the plugin/host model, per-plugin
> schema ownership, DI ports, and UI slots all stand unchanged.

## Context

Strategically the codebase is already DDD-shaped: plugins are bounded contexts,
each server plugin owns its schema and migrations, and contexts integrate only
through declared DI ports (`CONTENT_CATALOG`, `ACTIVITY_RECORDER`,
`CONTENT_ENTRY_EXTENSION`) and named admin UI slots.

Tactically, however, each context is an **anemic transaction script**:

- "Entities" are Drizzle `pgTable` rows; there are no rich domain objects.
- Invariants live in `class-validator` DTO decorators and in procedural service
  code (transactions + Postgres advisory locks), not in the model.
- Business rules, orchestration, persistence, and view-mapping interleave in one
  `@Injectable()` service (e.g. `WorkspaceService`, ~500 lines).
- There is deliberately **no repository** — services call the Drizzle client
  directly (`"no repository wrapper, by repo convention"`).
- The audit log (`ACTIVITY_RECORDER`) is written **in-band** in the caller's
  transaction; there is no domain-event mechanism.

The forces pushing us to change this now:

- **Testability.** An invariant like "a workspace must keep one admin" can only
  be tested by standing up a database; it should be a pure unit test.
- **Rule duplication.** The admin restates server validation by hand
  (`validateEntryValues` "mirroring the server's rules") — two sources of truth
  that drift.
- **Coupling through the audit path.** In-band recording means every audit-worthy
  mutation hard-codes a call to the recorder; nothing else can react to a state
  change, and the write path and the audit path cannot evolve independently.
- **A leaky boundary.** The whole `workspaces` domain lives inside
  `identity/server`; there is no `workspaces/server` package.

## Decision

We will adopt **tactical Domain-Driven Design inside each bounded context**,
keeping ADR-0002's strategic model intact. Concretely:

1. **Layer every context** into `domain / application / infrastructure /
   http` (server) and `domain / application / infrastructure / presentation`
   (admin), replacing the "feature-then-kind" and "one folder per hook" layouts.

2. **The dependency rule is the one non-negotiable:** `domain/` imports nothing
   from NestJS, Drizzle, React, `class-validator`, transport DTOs, or
   `infrastructure/`. Dependencies point **inward only**
   (`http → application → domain`; `infrastructure` implements `domain` ports).
   This is enforced by lint (see Consequences), not by convention alone.

3. **Model the domain, not the table.** Rich **aggregates** own their child
   entities and enforce invariants as methods (`Workspace.removeMember` throws
   `LastAdminError`); **value objects** replace primitive obsession (`Slug`,
   `Email`, branded `WorkspaceId`); invariants move out of DTO decorators into
   the model. DTOs keep only shape/`@IsString` checks for early 400s.

4. **Introduce repositories** as ports declared in `domain/` (interface + DI
   `Symbol`, the same mechanism as `CONTENT_CATALOG`) and implemented as Drizzle
   adapters in `infrastructure/`, with an explicit **mapper** (row ⇄ aggregate).
   This reverses the "no repository" convention. Advisory locks become the
   adapter's loading strategy, not logic in services.

5. **Split services into application services (use-cases) and domain services.**
   A use-case owns the transaction boundary (via a shared **Unit of Work**),
   loads/saves aggregates through repository ports, and holds no business rules.
   A domain service holds logic that spans aggregates but has no single owner
   (e.g. slug uniqueness). Controllers stay thin.

6. **Replace in-band audit recording with domain events + an outbox.**
   Aggregates raise events; a use-case writes them to an **outbox table in the
   same transaction** as the state change; a **post-commit dispatcher** fans them
   out to subscribers. The activity log becomes one subscriber. The
   `UnitOfWork`, outbox, and `DomainEvent` contract live once in
   `@orthacms/database`.

7. **Share domain rules through a kernel package where — and only where — both
   runtimes genuinely need the same rule.** `content` gets a
   `@orthacms/content-domain` package (pure TS, no React/Nest/Drizzle) holding
   field validation and the publish gate, imported by both `content/server` and
   `content/admin`. This is the single sanctioned FE↔BE code share.

8. **Apply the depth the context warrants — DDD where it pays, CRUD where it
   doesn't.** Rich-invariant contexts (`workspaces`, `content`, `identity`,
   `users`) get the full tactical stack. An audit log (`activity`) and analytics
   (`insights`) are naturally read-side/CRUD: they get mappers and event
   subscribers/projections, **not** aggregates. The admin side stays thin by
   design — the server owns business truth — so FE gets a `domain/` layer only
   for value objects and UX invariants, gateways (ports over `apiClient`),
   mappers as anti-corruption layers, and use-case hooks for multi-step flows.
   Forcing empty layers onto a thin context is a violation, not compliance.

We roll this out **incrementally**, one context at a time, in dependency order
(foundation → pilot → replication). The `workspaces` context is the pilot and the
reference implementation.

## Consequences

**Easier:**

- Domain invariants become pure, DB-free unit tests.
- A validation rule change is one edit both runtimes pick up (content kernel).
- New reactions to a state change are new subscribers, not edits to the write
  path; the audit log stops being a special case.
- Illegal states (bad slug, illegal status transition) become unrepresentable
  outside the aggregate.

**Harder / the cost we accept:**

- More moving parts per feature: an aggregate, VOs, a port, an adapter, a mapper,
  a use-case — more boilerplate than a single service method.
- A migration touching every context, FE and BE, over multiple PRs.
- Extracting `workspaces/server` from `identity/server` (frozen identity
  migration history; new package baselines forward).

**Follow-up work this commits us to:**

- **Foundation first:** `UnitOfWork` + outbox + `DomainEvent` in
  `@orthacms/database`; the `workspaces/server` extraction + pilot.
- **Enforcement:** ESLint module-boundary rules (inferred by `@orthacms/nx`
  onto layered packages) so `domain/` → Drizzle/Nest/React is a CI failure, not a
  review catch. Until a package is migrated it keeps its legacy layout; **each
  package's `AGENTS.md` declares which layout it is in**, and the `server-plugin`
  / `admin-plugin` skills document both modes.
- **Docs stay in lockstep:** the two authoring skills and this ADR are the source
  of truth; per-package `AGENTS.md` files flip as each context migrates so they
  always describe reality.

**What this rules out:** the "no repository, use Drizzle directly" convention;
in-band-only audit recording as the sole event mechanism; invariants that live
only in DTO decorators; and — for migrated contexts — the feature-then-kind /
one-folder-per-hook layouts.

## Alternatives considered

- **Keep the anemic transaction-script style.** Lowest effort and the team chose
  it deliberately. Rejected because the rule duplication, DB-coupled tests, and
  audit-path coupling are real and growing as content/AI features land.
- **Full tactical DDD symmetrically on the frontend** (client aggregates,
  repositories, the whole stack). Rejected: the admin has no independent source
  of truth — the server rejects invalid actions regardless — so client
  aggregates duplicate server rules and rot. We take the paying subset (VOs,
  gateways, ACL mappers, use-case hooks) only.
- **Event sourcing / CQRS across the board.** Far more than the domain needs.
  We take one narrow slice — an outbox for reliable event delivery, and
  projection read-models for `insights` — without event-sourcing aggregates.
- **A shared FE/BE domain package for every context.** Rejected as over-coupling:
  it re-links contexts we deliberately keep apart. Only `content` has rules both
  runtimes must apply identically, so only `content` gets a kernel.
