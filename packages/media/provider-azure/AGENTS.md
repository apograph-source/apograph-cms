# @orthacms/media-provider-azure

Azure Blob Storage. The one major object store with **no S3 compatibility at
all** — different protocol, different signature, containers instead of buckets —
so it needs its own adapter rather than an endpoint in `provider-s3`. It is the
gap that stopped a Microsoft-shop deployment running Ortha at all.

## What it exports

- `createAzureStorageProvider(config): StorageProvider`
- `config`: `{ container, connectionString?, accountName?, accountKey?,
  keyPrefix?, containerClient? }`

Three ways to connect, in the order deployments reach for them:

1. **`connectionString`** — what the portal hands you, and what Azurite prints.
2. **`accountName` + `accountKey`.**
3. **`containerClient`** — an already-built client. This is the escape hatch for
   **managed identity**: build one with `DefaultAzureCredential` from
   `@azure/identity` and pass it, and this package stays free of that
   dependency. It is also the seam the tests inject through, so they drive the
   same entry point a real caller uses rather than a private hook.

## `capabilities.directUrl` is computed, not hardcoded

A SAS token needs a **shared key** to sign. A deployment on managed identity has
none, so `directUrl` is `false` there and its downloads are proxied.

Declaring `true` unconditionally would let `MediaServerPlugin` accept
`directServe: 'signed-url'` on a deployment that cannot honour it — and the
failure would land per request rather than at boot, which is the whole thing
that design is meant to prevent. (A user-delegation SAS would let a managed
identity sign; it needs a delegation key fetched from the service, so it is a
follow-up, not a silent assumption.)

When it can sign, the SAS pins `rscd` (content disposition) and `rsct` (content
type) — the same rule as every other signing provider: a redirect discards the
app's own `Content-Disposition`, `nosniff` and CSP, and the stored MIME type is
the uploader's claim, so an uploaded `.html` would otherwise render on the
storage account's origin.

## What not to lose in a refactor

- **A failed upload deletes the blob.** Azure charges for uncommitted blocks and
  does not list them; the key never reached a caller, so nothing else can
  reclaim them. The `catch` calling `deleteIfExists` is what clears them.
- **A source error reaches the meter.** The body is piped through a
  `PassThrough` the SDK reads; without the forwarded `error`, an upload whose
  source dies waits forever on a stream that will never end.
- **Size and checksum are measured here**, like every provider: the core
  persists both and the reclaim path trusts them.
- **`get` maps to `ObjectNotFoundError`** for `BlobNotFound` / 404, and rethrows
  everything else. A throttled or unauthorized account is an outage, and
  dressing it as a 404 hides it behind a plausible answer.

## Testing: what the fake proves, and what it does not

`npx nx test @orthacms/media-provider-azure` runs the shared contract
(`describeStorageProvider`) plus this adapter's own cases against
`FakeContainerClient`.

**A fake agrees with whatever the code does.** It proves key shapes, metering,
the cleanup path, the error mapping and the capability computation — and nothing
about Azure. Before this is trusted with a deployment it needs:

- the contract suite against **Azurite** (`mcr.microsoft.com/azure-storage/azurite`),
  which is the cheapest real Azure surface, and
- one manual round-trip against a real storage account: upload, thumbnail,
  download, duplicate, delete, a restart to prove `verify()`, and — if signing —
  one signed URL fetched from the browser.

`directUrl` is the exception: SAS signing is local computation, so it is tested
for real with Azurite's published development key.

## Commands

- `npx nx test @orthacms/media-provider-azure` /
  `npx nx typecheck @orthacms/media-provider-azure` /
  `npx nx lint @orthacms/media-provider-azure`
