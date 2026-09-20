# 0012 — One storage provider per deployment, passed as one object

- **Status:** Accepted
- **Date:** 2026-08-23
- **Deciders:** Engineering

## Context

The Media Library keeps no bytes in the database: an asset row carries a
`storage_key` + `storage_provider` pointer and the blob lives behind a
`StorageProvider` implementation. That port was right; everything around it was
shaped for a question nobody was asking.

`MediaServerPlugin` took a **map** of named providers, an optional
`StorageResolver` handler that picked one per upload, and a `defaultProvider`
name in config for when no handler was supplied. `MediaPluginConfig` itself
carried `local` and `s3` settings blocks — so the plugin, whose whole point is
to name no backend, named two. The shipped app registered exactly one provider,
the resolver was never supplied, and `MEDIA_PROVIDER` selected between a
provider that existed and one that was a stub throwing from every method.

Three costs came with that shape:

- **Two ways to be wrong.** A `defaultProvider` string could name a provider
  nobody registered; a registered name could be misspelled in one deployment
  and correct in another. Both are checks the code had to carry.
- **A second convention.** The copilot registers model adapters as constructed
  objects (ADR-0004). Media registered them as a map plus a resolver plus a
  name. One idea, two spellings, learned twice.
- **Machinery for an unused mode.** Routing uploads across several live backends
  is a capability nobody asked for, and its cost was paid on every read of the
  media package.

## Decision

**A deployment runs exactly one storage provider, and the plugin takes it as one
object.**

```typescript
MediaServerPlugin({
    provider: createLocalStorageProvider(config.plugins.media.storage),
    config: config.plugins.media
});
```

- A provider is a **factory function returning an object** — the copilot's
  convention, kept.
- The object **describes itself**: `id` (recorded on every asset row) and
  `capabilities` (`directUrl`, `contentTypeMetadata`, `streamingPut`), plus
  optional `directUrl()` and `verify()`. The name is a fact about the adapter,
  not a string an operator repeats in two places.
- `MediaPluginConfig` carries `maxUploadBytes` and nothing else. Backend
  settings live in the host's own config, typed by the factory the host imports
  — the same arrangement as the copilot's provider settings (ADR-0004 §2).
- The registry, the resolver, `defaultProvider` and `MEDIA_PROVIDER` are
  **removed**. Which backend runs is decided by which factory `plugins.ts`
  calls.
- `media_asset.storage_provider` **stays**, and `StorageProviderCheck` refuses to
  boot when it holds a value other than the configured provider's `id`, naming
  the stale id and its row count.

## Consequences

Easier: writing a provider (one function, one `describeStorageProvider` call
from `@orthacms/media-provider-testkit`, one line in `plugins.ts`); reading the
media package; validating the wiring, which is now a handful of eager checks
with nothing to cross-reference.

Harder — and this is the trade, taken deliberately: **switching backend strands
existing assets.** There is no second provider live to serve rows written by the
previous one, so their bytes are unreachable until they are moved. We pay for
that openly rather than in production: the boot check turns what would be a
library of broken images into a refusal to start, with the numbers in the
message. A blob-moving tool is future work, wanted only when a real switch needs
one.

Also ruled out for now: routing by file (video to object storage, thumbnails to
disk), and reading through several backends during a migration. Both were
possible under the old shape and neither was used. Re-introducing either means a
new ADR, not a quiet re-add — the reason to write it down is that the code no
longer argues either way.

## Alternatives considered

**Keep the registry, drop only the resolver.** Retains the ability to read rows
written by a previous backend, which is the strongest argument for the map. But
that ability is only ever exercised during a migration nobody has scheduled, and
its price is a configurable name in two places plus a lookup on every read.
Rejected in favour of a boot check that reports the same situation.

**Keep `defaultProvider` as an explicit setting.** With one provider there is
nothing to be default over, and a name that can only be right is a name not
worth typing.

**Let the host pass the name alongside the object** (`{ name, provider }`).
That is the copilot's `ProviderRegistration`, and it makes sense there because a
deployment offers several models under operator-chosen labels. Here the label
would be one value per deployment, written into every row, misspellable in
exactly one place. The adapter owning its own `id` removes the failure mode
entirely.
