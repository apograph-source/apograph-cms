# @orthacms/media-provider-s3

The **S3-compatible** storage provider — written endpoint-first, not AWS-first.

`endpoint` plus `forcePathStyle` is the whole difference between AWS S3,
**Cloudflare R2**, MinIO, DigitalOcean Spaces, Backblaze B2, Wasabi, Scaleway,
Hetzner, Supabase Storage and Tigris. One adapter reaches all of them, which is
why this is one package and not ten.

## What it exports

- `createS3StorageProvider(config): StorageProvider` — the same shape as
  `createLocalStorageProvider`, so switching a deployment is one line in
  `plugins.ts` (and the type of `media.storage` moving with it).
- `config`: `{ bucket, region?, endpoint?, forcePathStyle?, credentials?,
  keyPrefix?, client? }`.

Capabilities: `{ directUrl: true, contentTypeMetadata: true, streamingPut: true }`
— the only shipped provider that declares `directUrl`.

### Two config decisions that matter

- **Omit `credentials` on a host with an instance role or IRSA.** Absent means
  "use the SDK's own provider chain"; an object of blank strings would shadow
  that chain with credentials that cannot sign, and the failure surfaces as a
  403 nobody can trace back to the config.
- **`region` defaults to `auto`**, which is what R2 expects. AWS needs its real
  region; most other services ignore the value but the signer still needs one.

## The four things not to lose in a refactor

1. **`put` is all-or-nothing.** A multipart upload that fails leaves parts
   billed, invisible to `ListObjects`, and unreachable — the key was never
   returned, so the core's reclaim loop cannot see them. The `catch` calls
   `upload.abort()`, and that is the only thing that removes them.
2. **A source error must reach the meter.** The body is piped through a
   `PassThrough` that `lib-storage` reads; without the forwarded `error`, an
   upload whose source dies waits forever on a stream that will never end — a
   request that never answers, which is worse than a failed upload.
3. **Size and checksum are measured here.** The core persists both and the
   reclaim path trusts them. `ETag` is not a sha256, and for a multipart object
   it is not even an MD5.
4. **`get` maps to `ObjectNotFoundError`.** This family of services says "no
   such object" in several shapes (`NoSuchKey`, `NotFound`, a bare 404), and a
   raw one escaping makes a missing blob a **500** where the route means 404.
   Anything that is *not* a missing key is rethrown — a permission error dressed
   as "not found" would hide an outage behind a plausible answer.

## `directUrl` pins the response headers, and must

A redirect discards the app's own `Content-Disposition`, `nosniff` and CSP, and
`media_asset.mime_type` is the uploader's unverified claim — an uploaded `.html`
served inline from the bucket is stored XSS on the bucket's origin. So the
signed URL carries `ResponseContentDisposition` and `ResponseContentType`, which
is precisely what earns this provider `capabilities.directUrl: true`. A backend
that cannot pin them must declare `false` and be proxied instead.

Nothing calls it yet: the download route still streams through the app. Wiring
it up is its own change, with its own e2e.

## Testing: what the fake proves, and what it does not

`npx nx test @orthacms/media-provider-s3` runs the shared contract
(`describeStorageProvider`) plus this adapter's own cases against
**`FakeS3Client`** — a real `S3Client` with only its `send` replaced.

Replacing just `send` is deliberate: `lib-storage` reads the client's own
`config` (`requestHandler` for progress events, `endpointProvider` to build the
uploaded object's `Location`), so a hand-rolled client object fails inside the
SDK rather than in our code. This way the command construction, endpoint
resolution and middleware stack are genuine and only the network hop is stubbed.

**A fake agrees with whatever the code does.** It proves the adapter's own logic
— key shapes, metering, error mapping, the abort path — and nothing about S3.
Before this provider is trusted with a deployment it needs:

- the same contract suite against a **MinIO** container, and
- one manual round-trip against a real **R2** bucket: upload, thumbnail, download,
  duplicate, delete, and a server restart to prove `verify()` passes.

`directUrl` is the exception — it is tested for real, because signing is local
computation: a client with static dummy credentials produces a genuine signature
offline.

## Commands

- `npx nx test @orthacms/media-provider-s3` / `npx nx typecheck @orthacms/media-provider-s3` /
  `npx nx lint @orthacms/media-provider-s3`
