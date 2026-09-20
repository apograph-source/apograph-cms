# 0008 — GraphQL is a protocol adapter over the public content API

- **Status:** Accepted
- **Date:** 2026-08-08
- **Deciders:** Engineering

## Context

`/api/v1` is a complete, token-authenticated content API: bearer tokens minted
by `identity-server`, a workspace bucket resolved per request, `read`/`full`
scopes mapped to permissions through the same `AccessPolicy` the session routes
use, content grants pruning which types a workspace can even name,
published-only reads, locale semantics behind `CONTENT_ENTRY_EXTENSION`, and a
write pipeline that owns validation, relation deltas, media-target checks,
revision numbering under a per-entry advisory lock, the outbox, and i18n sibling
sync.

Consumers asked for the same content over GraphQL. The obvious risk is not
building it — it is building it **twice**: a GraphQL layer that reaches into the
database directly, or reimplements "what may this token see", would double every
one of the rules above and leave two places to keep them in step. Security rules
that exist in two places do not stay identical.

Two structural questions had to be answered before any of it could be written:
whether the schema may be global, and whether to adopt `@nestjs/graphql`.

## Decision

**We will serve GraphQL as an adapter over the existing public API, and never as
a second implementation of it.** A resolver translates a GraphQL field and its
arguments into the DTO the REST read already takes, calls the same service, and
maps the result. `@orthacms/content-graphql` owns the schema, the resolvers,
the cost budget, and the error mapping — and nothing else. It has no schema, no
migrations, and no credential of its own; a token minted before it existed works
against it unchanged.

Three decisions follow from that, and are the substance of this record:

1. **The schema is derived per workspace grant set, not once at boot.** REST
   already refuses to let a token enumerate the content model beyond its
   workspace's grants; a single global schema would hand every token the whole
   model through introspection, which is a worse leak than the one REST avoids.
   `buildContentSchema(registry, granted)` emits only granted types, memoised
   per grant set behind a short TTL. The cache is a freshness knob, not the
   authorization: every resolver re-checks the live grant set through
   `resolveGrantedType`.

2. **We execute with `graphql-js` inside an ordinary Nest controller, rather
   than adopting `@nestjs/graphql` + Apollo.** A per-request schema is
   incompatible with `GraphQLModule.forRoot`, and — more importantly — a plain
   controller lets `ApiTokenGuard` and `ApiTokenWorkspaceGuard` run as _the same
   objects_ they do on every other `/v1` route. Under `@nestjs/graphql` they
   would need a `GqlExecutionContext` adapter, forking the authentication path.

3. **A GraphQL operation carries an explicit cost budget.** REST bounded a
   request structurally (one route, one page, `MAX_PAGE_SIZE`); a document does
   not. Query length, depth, field count, estimated complexity, and one
   operation per request are checked after parsing and before execution.

## Consequences

**Easier.** One visibility rule, one filter language, one grant gate, one write
path, shared by both protocols — a change to what a token may see lands in
`content-server` and both protocols follow. The new package is small enough to
hold in your head. Adding a content type adds GraphQL fields for free, because
the schema is generated from the registry. An ungranted type is now a
_validation_ error rather than a 404, so the request never reaches a resolver.

**Harder.** `content-server` now exports the public API's collaborators
(`PublicEntriesQuery`, `PublicEntryWritesService`, `WorkspaceGrantsQuery`, the
guards, `resolveGrantedType`, the query DTOs) — they are a supported surface,
and changing one changes both protocols at once. Introspection legitimately
differs per token, which reads as a bug until it is explained. Not using
`@nestjs/graphql` means depth/complexity limits, batching, and any playground
are ours to maintain.

**Ruled out for now.** Typed per-type filter inputs (the shared JSON tree keeps
one validator) and subscriptions (nothing publishes content events yet).

**Amended.** A GraphiQL playground was initially ruled out and is now shipped at
`GET /v1/graphql/playground`, gated on the host's `docs.enabled` so it is off in
production by default. It is served self-contained rather than from a CDN, which
constrains us to **graphql 16**: every package shipping a prebuilt GraphiQL
bundle peers on ≤16, and bundling `graphiql` ourselves would need a build step
these source-consumed packages deliberately do not have. 16 is also what the
tooling ecosystem expects, so this is not much of a concession.

**Follow-up.** The public API — both protocols — still has no rate limit; the
token id is the natural key. Grant changes wait out the schema-cache TTL rather
than busting it, which needs a port from `workspaces-server` to fix properly.

## Alternatives considered

**A single global schema, authorized in resolvers.** Simpler to build and cache,
and it would have let us use `@nestjs/graphql`. Rejected because introspection
would expose every content type in the deployment to every token — a capability
REST deliberately withholds, so adopting it would have been a regression in the
security model rather than a new protocol.

**`@nestjs/graphql` + Apollo with a global schema.** The conventional Nest
choice, with a mature ecosystem. Rejected with the point above; the guard
duplication it forces was the second strike.

**A folder inside `content-server` instead of a package.** Fewer exports to
maintain. Rejected because the `graphql` dependency would then load in every
deployment, including those that never serve the endpoint, and ADR-0002's plugin
model exists precisely so a capability can be left out of the plugin list.

**Resolvers over Drizzle directly.** The fastest path to a working endpoint, and
the one that quietly duplicates `readableWhere`, the grant gate, the locale
scope, and the write invariants. Rejected on the premise of this whole record.
