# `@orthacms/media-domain`

The **storage port** — the interface every `@orthacms/media-provider-*` speaks,
and the one error `get` promises to reject with. No NestJS, no Drizzle, no
React, and **no dependencies at all**.

| File                            | What lives there                                                          |
| ------------------------------- | ------------------------------------------------------------------------- |
| `storage-provider.ts`           | `StorageProvider`, its capability and payload types, and the DI token.    |
| `errors/object-not-found.error` | What `get` rejects with when the row survives and the bytes do not.       |

## Why this is a package

An application picks **one** backend and must not pay for the other six. That
was true of the adapters' own imports — each one carries its vendor SDK and
nothing else — and false of the port they reached it through: `ObjectNotFoundError`
is a *value*, it came from `@orthacms/media-server`, and that package's root
barrel re-exports `MediaModule`. So `require('@orthacms/media-provider-local')`
loaded `@nestjs/common`, and `@orthacms/media-server` sat in every adapter's
runtime `dependencies`, which made `npm i @orthacms/media-provider-s3` install
NestJS, Drizzle, Express and Sharp to talk to a bucket.

The dossier had claimed the adapters "depend only on the port's *type* (erased
at compile time)". They now do, plus one exception the type system cannot
express — an error class — which is why this package exists rather than a
subpath export: a subpath would have fixed the require-graph and left the
manifest alone, and the manifest is what `npm i` reads.

## The rules

**No dependencies, ever — `dependencies`, `peerDependencies`, anything.** Seven
adapters and the server inherit whatever is added here, which is exactly how a
"framework-free kernel" stops being one without a single line of it changing.
The one entry in the *published* manifest is `tslib`, which
`tools/release/pack.mjs` adds to every package because the workspace compiles
with `externalHelpers`; it is not something this package asked for.
`package-manifest.spec.ts` fails on the checked-in manifest, and
`provider-testkit/src/lib/adapter-packages.spec.ts` loads an adapter in a child
process with a `Module._load` hook and fails if the framework reappears in the
require graph by any route at all.

**Scope is the adapter seam, not media's whole domain layer.** The asset and
folder aggregates, their value objects and their events stay in
`@orthacms/media-server`'s `domain/` — framework-free in their own right, but
they import `@orthacms/database` for the `DomainEvent` contract, and no adapter
has ever needed them. `@orthacms/identity-domain` is scoped the same way: the
`SsoProvider` port, and no other part of identity's domain.

**`STORAGE_PROVIDER` is a `Symbol`, so it must resolve to one module instance.**
It is the DI token the composition root binds, and `@orthacms/transfer-server`
injects it too. Lockstep versioning is what makes that safe — every package
asks for the same version, so npm keeps one copy.

## Commands

- `npx nx test @orthacms/media-domain`
- `npx nx typecheck @orthacms/media-domain`
