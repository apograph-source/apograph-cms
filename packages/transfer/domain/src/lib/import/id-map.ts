/**
 * The **id map** — the run-scoped bookkeeping that turns a document's internal
 * pointers into real target rows.
 *
 * An import writes records one at a time, but the graph it is writing is not a
 * list: a post created on line 3 points at an author created on line 9. So
 * every write records both handles it could later be found by — the source row
 * id it arrived with, and its natural key — and every reference is resolved
 * through this map before the database is asked anything.
 */

import {
    keyFingerprint,
    type TransferRef
} from '../document/transfer-document';

/** How a reference was resolved — reported so a run can be explained. */
export const RESOLVED_VIA = {
    /** Matched a record written earlier in this same run. */
    Document: 'document',
    /** Matched an existing row in the target workspace by natural key. */
    Existing: 'existing',
    /** Nothing matched. */
    Unresolved: 'unresolved'
} as const;

/** How a reference was resolved. */
export type ResolvedVia = (typeof RESOLVED_VIA)[keyof typeof RESOLVED_VIA];

/** The outcome of resolving one reference. */
export interface RefResolution {
    /** The target row's id, when one was found. */
    targetId?: string;
    via: ResolvedVia;
}

/**
 * Source handles → target row ids, for the length of one import run.
 *
 * Both indexes are needed and neither is redundant. The **id** index covers a
 * record the document itself created moments ago, which by definition has no
 * pre-existing key match. The **key** index covers a target row that was
 * already there — and also lets two records in one document that name the same
 * neighbour by key (but from different source installations, so different ids)
 * converge on one row instead of creating two.
 */
export class TransferIdMap {
    private readonly byId = new Map<string, string>();
    private readonly byKey = new Map<string, string>();

    /**
     * Records that `$type`/`sourceId`/`key` now live at `targetId`.
     *
     * A key with no fields is not indexed: it would collide with every other
     * keyless record of the type and start linking unrelated rows together.
     */
    remember(
        type: string,
        sourceId: string | undefined,
        key: Record<string, string>,
        targetId: string,
        locale?: string
    ): void {
        if (sourceId) this.byId.set(idIndex(type, sourceId), targetId);
        if (Object.keys(key).length > 0) {
            this.byKey.set(keyFingerprint(type, key, locale), targetId);
        }
    }

    /** Records an existing target row found by key, without a source id. */
    rememberExisting(
        type: string,
        key: Record<string, string>,
        targetId: string,
        locale?: string
    ): void {
        this.remember(type, undefined, key, targetId, locale);
    }

    /**
     * Resolves a reference against what this run has written so far.
     *
     * Id first, then key — the order matters. Within one document the id is the
     * exact answer, while the key is a guess that could match a *different*
     * pre-existing row that happens to share a slug. Preferring the id means a
     * self-contained document round-trips exactly, whatever else is in the
     * target workspace.
     */
    resolve(ref: TransferRef): RefResolution {
        if (ref.$id) {
            const byId = this.byId.get(idIndex(ref.$type, ref.$id));
            if (byId) return { targetId: byId, via: RESOLVED_VIA.Document };
        }
        if (Object.keys(ref.$key).length > 0) {
            const byKey = this.byKey.get(
                keyFingerprint(ref.$type, ref.$key, ref.$locale)
            );
            if (byKey) return { targetId: byKey, via: RESOLVED_VIA.Existing };
        }
        return { via: RESOLVED_VIA.Unresolved };
    }

    /** Whether anything has been written for this source record yet. */
    has(type: string, sourceId: string): boolean {
        return this.byId.has(idIndex(type, sourceId));
    }
}

/**
 * A run-scoped map of source asset id → target asset id, plus the checksum
 * index that keeps an import from re-uploading bytes the target already holds.
 */
export class TransferAssetMap {
    private readonly bySourceId = new Map<string, string>();
    private readonly byChecksum = new Map<string, string>();

    remember(sourceId: string, targetId: string, checksum?: string): void {
        this.bySourceId.set(sourceId, targetId);
        if (checksum) this.byChecksum.set(checksum, targetId);
    }

    /** Seeds a checksum the target workspace already holds. */
    rememberChecksum(checksum: string, targetId: string): void {
        this.byChecksum.set(checksum, targetId);
    }

    resolve(sourceId: string, checksum?: string): string | undefined {
        return (
            this.bySourceId.get(sourceId) ??
            (checksum ? this.byChecksum.get(checksum) : undefined)
        );
    }
}

/** The id index's key, JSON-encoded for the same reason the fingerprint is. */
function idIndex(type: string, sourceId: string): string {
    return JSON.stringify([type, sourceId]);
}
