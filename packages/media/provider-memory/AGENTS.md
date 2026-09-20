# @orthacms/media-provider-memory

An in-memory `StorageProvider` — blobs in a `Map`, plus the three inspection
methods that make that useful (`keys()`, `totalBytes()`, `clear()`).

**Shipped, not test scaffolding.** The copilot ships `provider-fake` for the
same reason ([ADR-0004](../../../docs/adr/0004-model-agnostic-copilot-provider.md) §3):
a loop nobody can drive without a key and a network is a loop nobody exercises.
Storage needed it more — before this package `apps/server-e2e` stood up its own
`Map`-backed provider inline, a second implementation of the port that no rule
held to the contract. It had already drifted: a missing key rejected with a bare
`Error` rather than `ObjectNotFoundError`, so the route that maps that error to
a **404** was never exercised by any e2e run.

## What it exports

- `createMemoryStorageProvider(config?): MemoryStorageProvider` — `config` is
  `{ maxTotalBytes? }`, default 256 MB.
- `MemoryStoreFullError` — raised when a `put` would push the store past that
  cap. A test that uploads more than it meant to should fail as a test, not as
  an out-of-memory kill that takes the whole run with it.

`MemoryStorageProvider` extends the port with `keys()` (sorted),
`totalBytes()` and `clear()`. Those are the provider's own API, not the port's:
the core never sees them, and `apps/server-e2e/src/support/media-storage.ts` is
what turns them into `blobStoreKeys()` / `resetBlobStore()`.

## What it is for, and what it is not

**For:** the e2e harness, a contributor running the admin with no object store,
and anyone writing a provider who wants a known-good one to read.

**Not for a deployment.** Blobs die with the process, and `StorageProviderCheck`
refuses to boot a database whose rows were written by anything else — including
a previous run of this one, whose bytes are gone.

## The two decisions worth knowing

- **`contentTypeMetadata: true`**, where `provider-local` declares `false`. A
  `Map` has somewhere to put the content type and a filesystem does not. It is
  the only provider in the repo that declares it, so it is also the only place
  the `true` branch of that capability is exercised.
- **`put` buffers, and says so** (`streamingPut: false`). Bytes are metered
  through a `PassThrough` for size + sha256 and nothing reaches the `Map` until
  the whole body has arrived — which is the port's all-or-nothing rule met by
  construction rather than by cleanup: a body that fails mid-stream leaves the
  store exactly as it was.

Keys are built like `provider-local`'s
(`<workspaceId>/<assetId>[/variants]/<sanitized name>`). The port says a key is
opaque, so this is not required — but a key that reads the same in both makes a
`storage_key` in a database dump legible, and lets an assertion be shared.

## Commands

- `npx nx test @orthacms/media-provider-memory` — its own suite plus
  `describeStorageProvider` from `@orthacms/media-provider-testkit`, the same
  contract `provider-local` runs.
- `npx nx typecheck @orthacms/media-provider-memory` / `npx nx lint @orthacms/media-provider-memory`
