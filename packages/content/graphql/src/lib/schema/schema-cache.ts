import type { ContentTypeRegistry } from '@orthacms/content-server';
import type { GraphQLSchema } from 'graphql';
import { buildContentSchema } from './build-schema';

/**
 * Memoises built schemas by grant set.
 *
 * Building a schema walks every granted type's fields and allocates a few dozen
 * GraphQL type objects — cheap, but not per-request cheap, and a deployment has
 * only as many distinct grant sets as it has workspace configurations. The key
 * is the sorted grant list, so two workspaces granted the same content share one
 * schema.
 *
 * **The TTL is a freshness knob, not a security boundary.** A revoked grant
 * stops being *described* within the TTL; it stops being *readable*
 * immediately, because every resolver re-checks the live grant set through
 * `resolveGrantedType`. Getting that the wrong way round — treating the cached
 * schema as the authorization — is the mistake this comment exists to prevent.
 */
export class SchemaCache {
    private readonly entries = new Map<string, CachedSchema>();

    constructor(
        private readonly registry: ContentTypeRegistry,
        private readonly ttlMs: number,
        /** Injectable clock, so the expiry is testable without waiting. */
        private readonly now: () => number = Date.now
    ) {}

    /** The schema for `granted`, built or reused. */
    get(granted: ReadonlySet<string>): GraphQLSchema {
        const key = [...granted].sort().join('\u0000');
        const cached = this.entries.get(key);
        const now = this.now();
        if (cached && cached.expiresAt > now) {
            return cached.schema;
        }
        const schema = buildContentSchema(this.registry, granted);
        this.evictExpired(now);
        this.entries.set(key, { schema, expiresAt: now + this.ttlMs });
        return schema;
    }

    /** How many schemas are held right now. Diagnostics, and the eviction test. */
    get size(): number {
        return this.entries.size;
    }

    /** Drops every cached schema. For tests, and for a future grant-change hook. */
    clear(): void {
        this.entries.clear();
    }

    /**
     * Drops entries whose TTL has passed.
     *
     * An expired entry was only ever *replaced* — by the same key being asked
     * for again — so nothing removed one nobody asks for any more. The map
     * therefore held one schema per grant set the process had **ever** served,
     * not one per active workspace configuration: editing a workspace's content
     * grants mints a new key and orphans the old one, with a whole
     * `GraphQLSchema` (a few dozen object types and their thunked field maps)
     * attached.
     *
     * Guarded by a threshold so the ordinary path stays O(1): a deployment with
     * a handful of grant sets never walks the map at all, and one that has
     * churned through many pays a sweep only on a build it was already paying
     * for.
     */
    private evictExpired(now: number): void {
        if (this.entries.size <= EVICTION_THRESHOLD) {
            return;
        }
        for (const [key, entry] of this.entries) {
            if (entry.expiresAt <= now) {
                this.entries.delete(key);
            }
        }
    }
}

/**
 * Entries tolerated before a write sweeps the expired ones.
 *
 * Comfortably above any real deployment's number of distinct grant sets, so the
 * sweep is a backstop against unbounded growth rather than part of the hot
 * path. The cleaner fix is the grant-change invalidation hook this package's
 * AGENTS.md names as not-shipped, which would let `clear()` be called for real
 * and make the TTL — and this — redundant.
 */
const EVICTION_THRESHOLD = 32;

/** One cached schema and when it goes stale. */
interface CachedSchema {
    schema: GraphQLSchema;
    expiresAt: number;
}
