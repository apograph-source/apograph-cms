import type { SerializedContentType } from '../registry/content-type-registry';
import { CONTENT_FIELD_TYPE } from '../types/fields';
import type { RevisionSnapshot } from '../revisions/types/revision-view';

/** One field that differs between two revision snapshots. */
export interface SnapshotFieldChange {
    /** The field's name, as the model knows it from `admin_content_types`. */
    field: string;
    /** The field's declared type, so a model can read the values correctly. */
    type: string;
    /**
     * Whether the field's links live in a join table (an owning many-relation
     * or any inverse). Its values are **ordered id lists**, not scalars.
     */
    isLinkSet: boolean;
    /** The value in the older of the two revisions. */
    from: unknown;
    /** The value in the newer one. */
    to: unknown;
}

/** A field whose links live in a join table (owning many, or any inverse). */
function isLinkSet(field: SerializedContentType['fields'][number]): boolean {
    return (
        field.type === CONTENT_FIELD_TYPE.Relation &&
        !!field.relation &&
        (field.relation.many || !!field.relation.inverse)
    );
}

/** Treat null / undefined / empty string as one "empty", so they aren't a change. */
function normalize(value: unknown): unknown {
    return value == null || value === '' ? null : value;
}

/** Structural equality for scalar / FK / json values, empties collapsed. */
function sameValue(a: unknown, b: unknown): boolean {
    return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/** Order-sensitive equality for a link set — the owning side's order is data. */
function sameLinks(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Diffs two revision snapshots field by field, in schema order, returning
 * **only what changed**.
 *
 * Returning only the changes is the point. The admin's dialog renders every
 * field because a person scanning a table wants the unchanged rows for context;
 * a model reasoning about "what did this edit do" gets nothing from forty
 * `changed: false` rows except a larger prompt. The count of unchanged fields is
 * reported separately, so the answer can still say "3 of 41 fields changed".
 *
 * The comparison rules mirror `content-admin`'s `diffRevision` exactly —
 * empties collapse so `null` → `''` is not an edit, and link sets compare
 * **order-sensitively** because the owning side's order is meaningful data. The
 * duplication is deliberate for now: the two sides type their schema
 * differently (`SerializedContentType` here, the admin's `ContentTypeDetail`
 * there), so sharing this through `@orthacms/content-domain` means unifying
 * those types first — a refactor, not a feature. If the rules ever disagree,
 * that is the fix, not a third copy.
 */
export function diffSnapshots(
    type: SerializedContentType,
    from: RevisionSnapshot,
    to: RevisionSnapshot
): { changes: SnapshotFieldChange[]; unchangedFields: number } {
    const changes: SnapshotFieldChange[] = [];
    let unchanged = 0;

    for (const field of type.fields) {
        if (isLinkSet(field)) {
            const before = from.relations?.[field.name] ?? [];
            const after = to.relations?.[field.name] ?? [];
            if (sameLinks(before, after)) {
                unchanged++;
                continue;
            }
            changes.push({
                field: field.name,
                type: field.type,
                isLinkSet: true,
                from: before,
                to: after
            });
            continue;
        }

        const before = from.values?.[field.name];
        const after = to.values?.[field.name];
        if (sameValue(before, after)) {
            unchanged++;
            continue;
        }
        changes.push({
            field: field.name,
            type: field.type,
            isLinkSet: false,
            from: before ?? null,
            to: after ?? null
        });
    }

    return { changes, unchangedFields: unchanged };
}
