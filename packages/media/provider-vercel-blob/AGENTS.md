# @orthacms/media-provider-vercel-blob

Vercel Blob — the smallest adapter in the set, and the one with a caveat that
belongs in a deployment decision rather than in code.

## Every blob is world-readable

Vercel Blob has **one access mode: `public`**. The URL it returns is permanent,
unguessable and unauthenticated. Anyone who obtains it — a copied `<img src>`, a
browser extension, a proxy log, a forwarded email — can fetch that asset
forever, with no reference to who they are.

The Media Library is otherwise **private by default**: every
`GET /media/assets/:id/raw` checks workspace membership, and a non-member gets
the same 404 as a missing asset. This backend cannot uphold that for anyone
holding the underlying URL. The app keeps enforcing its own rules — the API
returns `/media/assets/:id/raw`, never the blob URL — but a second, public copy
of the bytes exists and cannot be revoked short of deleting the blob.

Fine for a marketing site's images. **Not fine for a workspace whose media is
confidential.** No adapter can paper over that, so it is stated here, in the
provider's own doc comment, and in the scaffolder's hint.

## `capabilities.directUrl` is false, deliberately

The store's URL never expires and carries no per-request disposition. The port's
`directUrl` promises both — a short lifetime, and a pinned
`Content-Disposition` / `Content-Type` — so declaring it would be a lie that
hands out an unrevocable link and serves an uploaded `.html` inline from the
blob host.

Proxying also keeps the membership check on the request path, which is the
library's actual access rule. This is the clearest case in the repo of a
capability being a **claim about what a backend can honour**, not a wish.

## What it exports

- `createVercelBlobStorageProvider(config?): StorageProvider`
- `config`: `{ token?, keyPrefix?, api? }`. Omit `token` on Vercel itself, where
  `BLOB_READ_WRITE_TOKEN` is in the environment and the SDK reads it.

`api` is the injection seam: `@vercel/blob` exports free functions rather than a
client, so the seam is the three-function interface the provider accepts — the
same one a caller could substitute to route through their own transport.

## What not to lose in a refactor

- **`addRandomSuffix: false`.** The pathname this adapter computes *is* the
  storage key. With the SDK's default suffix on, the blob lands somewhere the
  adapter cannot name, and every later `get` / `remove` misses.
- **The upload and the pipeline are awaited together** (`Promise.all`), not in
  sequence. Awaiting the upload first meant that when it rejected, the
  pipeline's own rejection had no handler yet — an unhandled rejection, which in
  Node kills the process rather than failing the request. The contract suite's
  mid-stream-failure case catches this, and did.
- **`get` calls `head` first.** It turns a missing blob into a rejection before
  any stream exists, which is what lets the route answer 404 rather than a
  streaming 200 it cannot take back — and it is where the public URL comes from.
- **`verify` asks about a pathname that will not exist.** There is no
  store-level metadata call, so a "not found" *is* the proof that the token and
  the store are good; anything else fails the boot.

## Testing

`npx nx test @orthacms/media-provider-vercel-blob` runs the shared contract plus
this adapter's own cases against `FakeBlobApi`, which also serves the blobs over
a stubbed global `fetch` so `get` is exercised end to end.

A fake agrees with whatever the code does. A real store is the acceptance step:
upload, thumbnail, download, duplicate, delete, and a restart to prove
`verify()` — plus one look at the blob URL in the Vercel dashboard to see, in
person, that it is public.

## Commands

- `npx nx test @orthacms/media-provider-vercel-blob` /
  `npx nx typecheck @orthacms/media-provider-vercel-blob` /
  `npx nx lint @orthacms/media-provider-vercel-blob`
