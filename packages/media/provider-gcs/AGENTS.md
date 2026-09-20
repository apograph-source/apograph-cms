# @orthacms/media-provider-gcs

Google Cloud Storage, natively.

## You may not need this package

GCS speaks the **S3 XML API** in interoperability mode, so
`@orthacms/media-provider-s3` reaches it today:

```typescript
createS3StorageProvider({
    bucket,
    endpoint: 'https://storage.googleapis.com',
    credentials: { accessKeyId: HMAC_ACCESS_ID, secretAccessKey: HMAC_SECRET }
})
```

That is one fewer package to keep, and it is the right answer for most
deployments. This adapter exists for the one it is not: **HMAC keys are a
long-lived secret many organizations forbid by policy, and they rule out
Workload Identity.** Native auth is the reason to be here.

## What it exports

- `createGcsStorageProvider(config): StorageProvider`
- `config`: `{ bucket, projectId?, keyFilename?, credentials?, keyPrefix?,
  signWithIam?, bucketClient? }`

`bucketClient` takes an already-built `Bucket` — hand-built auth, or a test
stub. It is the same seam the tests inject through, so they drive the entry
point a real caller uses.

## `capabilities.directUrl` is computed, not hardcoded

Signing needs a private key (`keyFilename` / `credentials`) or an explicit
opt-in to IAM `signBlob` (`signWithIam`, how a Workload Identity deployment
signs — the library asks IAM to sign for it). **Bare ADC has neither**, so it
declares `false` and its downloads are proxied.

`signWithIam` is opt-in rather than assumed because it needs the
`iam.serviceAccounts.signBlob` permission; assuming it would mint URLs that fail
at request time, and let `MediaServerPlugin` accept `directServe: 'signed-url'`
on a deployment that cannot honour it.

## What not to lose in a refactor

- **`get` reads metadata before it opens the stream.** `createReadStream` opens
  lazily, so a missing object surfaces as an error *on the stream* — by which
  point the response is already a streaming 200 that can no longer become the
  404 the route owes the caller. One HEAD-shaped call buys that back, and it is
  the port's contract, not an optimization to remove.
- **A failed upload deletes the object.** A resumable upload that dies part-way
  leaves an incomplete object the bucket keeps until a lifecycle rule sweeps it,
  and the key never reached a caller.
- **`pipeline` wires source → meter → write stream**, rather than hand-wired
  events: it propagates a source error into the write stream and destroys both,
  which is what stops a dead upload hanging on a stream that will never end.
- **`get` maps 404 to `ObjectNotFoundError`** and rethrows everything else — a
  403 is a permissions problem, and dressing it as "not found" hides it.

## Testing: what the fake proves, and what it does not

`npx nx test @orthacms/media-provider-gcs` runs the shared contract plus this
adapter's own cases against `FakeBucket`, whose `createReadStream` opens lazily
exactly like the real one — which is what makes the metadata-first rule
testable.

**A fake agrees with whatever the code does.** Signing is asserted at the
options level (the fake records what `getSignedUrl` was asked for), not by
verifying a real signature. Before this is trusted with a deployment it needs a
manual round-trip against a real bucket: upload, thumbnail, download, duplicate,
delete, a restart to prove `verify()`, and — if signing — one signed URL fetched
from a browser, since v4 signing and IAM `signBlob` are the parts a fake cannot
speak for.

## Commands

- `npx nx test @orthacms/media-provider-gcs` /
  `npx nx typecheck @orthacms/media-provider-gcs` /
  `npx nx lint @orthacms/media-provider-gcs`
