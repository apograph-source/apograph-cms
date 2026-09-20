# @orthacms/media-provider-testkit

The **`StorageProvider` contract, as a runnable suite**. One export,
`describeStorageProvider(name, harness)`, which any provider package calls from
its own spec.

It exists because the port's invariants used to live only in prose, in
`provider-local/AGENTS.md`. Every one of them is a claim the media core relies
on and cannot check for itself — it reclaims blobs by key, streams `get`
straight into an HTTP response, and stores derivatives beside originals — so a
provider written outside this repo had no way to discover it broke one.

## Using it

```typescript
describeStorageProvider('media-provider-local', {
    create: () => createLocalStorageProvider({ rootDir: mkdtempSync(…) }),
    cleanup: (provider) => rmSync(rootFor(provider), { recursive: true }),
    storedKeys: (provider) => walk(rootFor(provider))
});
```

- **`create`** runs per case, so a provider holding state hands out a fresh one
  and cases cannot leak into each other.
- **`storedKeys`** is optional but wanted: it turns the all-or-nothing check
  from "the promise rejected" into "and it left nothing behind", which is the
  half that matters — a failed `put` never handed its key back, so anything it
  leaves is unreachable garbage no caller can reclaim.

## What it asserts

- **identity** — a non-empty `id`, a complete `capabilities`, and `directUrl()`
  present exactly when `capabilities.directUrl` says so.
- **`put`** — true size and sha256; bytes round-trip through `get`; two assets
  with the same file name get distinct keys; a derivative never collides with an
  original called `thumb.webp`; a body that fails mid-stream leaves nothing.
- **`get`** — rejects for a key that was never written, and for one that was
  removed. Rejecting *before* the stream opens is the point: the download route
  turns a rejection into a 404, and once bytes flow the response is a streaming
  200 that can no longer become one.
- **`remove`** — idempotent, and a no-op for a key that never existed. Reclaim
  is post-commit and best-effort; a provider that threw here would add noise
  nobody can act on.
- **everything rejects rather than throwing synchronously** — a sync throw lands
  outside the `try` that was meant to reclaim the blobs.

## Adding a case

Add one only for something **every** backend must do. A rule that is true of a
filesystem and meaningless for an object store belongs in that package's own
spec — the kit is the shared contract, and a filesystem-shaped kit is how a
remote provider ends up failing for the wrong reason.

## Commands

- `npx nx typecheck @orthacms/media-provider-testkit` /
  `npx nx lint @orthacms/media-provider-testkit`
- `npx nx test @orthacms/media-provider-testkit` — the kit against its own
  reference in-memory provider, so a suite no correct implementation passes
  cannot ship unnoticed. All six adapters call it: local, memory, s3, gcs,
  azure and vercel-blob.

## The structural half: `adapter-packages.spec.ts`

Beside the runnable contract sits the claim the contract cannot make — that an
application picking one backend does not pay for the other five. It reads every
`packages/media/provider-*` manifest and source and asserts that none declares
or imports `@nestjs/*`, `react`, `drizzle-orm`, `class-validator`, `express` or
`@orthacms/database`; that every non-relative import is a node built-in or a
package that manifest declares (a denylist only bans what someone thought of);
and that the one Ortha package an adapter reaches for is `@orthacms/media-domain`.

Then it walks the **whole import graph** out of each adapter's entry point,
through the workspace packages it reaches, and fails if a forbidden package
turns up anywhere in the closure. That half exists because the manifest scan
missed the real breach: every adapter imported `ObjectNotFoundError` — a *value*
— from `@orthacms/media-server`, whose barrel re-exports `MediaModule`, so
`require('@orthacms/media-provider-local')` loaded `@nestjs/common` three hops
away while declaring and importing no framework at all. The port moved to
`@orthacms/media-domain`; the walk is what stops it coming back by some other
route.

It lives here rather than in `server` because it is a statement about the
adapters as a set, which is this package's whole subject.
