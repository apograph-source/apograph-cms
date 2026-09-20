/**
 * Public API of `@orthacms/media-domain` — the **storage port**, and nothing
 * else.
 *
 * This package exists so that installing a storage adapter installs a storage
 * adapter. Every `@orthacms/media-provider-*` needs two things from the core:
 * the port's types, and `ObjectNotFoundError` — which is a *value*, because
 * `get` promises a particular rejection rather than merely some rejection. Both
 * used to live behind `@orthacms/media-server`'s root barrel, which re-exports
 * `MediaModule`, so `require('@orthacms/media-provider-s3')` loaded NestJS and
 * `npm i` of one adapter pulled NestJS, Drizzle, Express and Sharp along with
 * it. An adapter is a hundred lines over a vendor SDK; it should cost that.
 *
 * The rule that keeps it true is in `package.json`: **no dependencies, of any
 * kind**, asserted by `package-manifest.spec.ts`. One added here is inherited
 * by all seven adapters and by the server that hosts them.
 *
 * Scope is deliberately the adapter seam, not everything domain-shaped in
 * media — the same scope `@orthacms/identity-domain` has, which holds the
 * `SsoProvider` port and no other part of identity's domain layer. The asset
 * and folder aggregates, their value objects and their events stay in
 * `@orthacms/media-server`'s `domain/` layer: they are framework-free too, but
 * they depend on `@orthacms/database` for the `DomainEvent` contract, and no
 * adapter has ever needed them.
 */

export type {
    StorageProvider,
    StorageCapabilities,
    StoredObject,
    PutObject,
    DirectUrlOptions
} from './lib/storage-provider';
export { STORAGE_PROVIDER } from './lib/storage-provider';

export { ObjectNotFoundError } from './lib/errors/object-not-found.error';
