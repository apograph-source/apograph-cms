import type { ReactNode } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Badge } from '@orthacms/design-system';
import type {
    MediaRef,
    RelationRef
} from '../../../../../../../domain/types/contentType';
import { CONTENT_FIELD_TYPE } from '../../../../../../../domain/constants';
import type { RevisionFieldDiff } from '../../../../../../../domain/revisionDiff';
import { formatRevisionValue } from '../formatRevisionValue';
import { MediaRefList } from '../MediaRefList';
import { RelationRefList } from '../RelationRefList';

const messages = defineMessages({
    current: {
        id: 'content.revisions.preview.current',
        defaultMessage: 'Current'
    },
    version: {
        id: 'content.revisions.preview.versionCol',
        defaultMessage: 'Version {n}'
    },
    changed: {
        id: 'content.revisions.preview.changed',
        defaultMessage: 'Changed'
    }
});

/** Resolved relation records for one field, per side. */
export type DiffRelationRefs = {
    /** Current (latest / live) side. */
    current?: RelationRef[];
    /** Previewed revision side. */
    revision?: RelationRef[];
    /** True link counts per side (for the "+N more" tail). */
    currentTotal?: number;
    revisionTotal?: number;
};

/** Resolved media assets for one field, per side. */
export type DiffMediaRefs = {
    /** Current (latest / live) side. */
    current?: MediaRef[];
    /** Previewed revision side. */
    revision?: MediaRef[];
};

/** The field's human label — its admin `label`, else the machine name. */
function fieldLabel(diff: RevisionFieldDiff): string {
    const label = diff.field.admin['label'];
    return typeof label === 'string' && label ? label : diff.field.name;
}

/**
 * One field row in the {@link RevisionPreviewDialog}. A **relation** field
 * renders the actual linked records (`RelationRefList`) and a **media** field
 * the actual assets (`MediaRefList`) — both resolved server-side, because a raw
 * uuid tells the reader nothing about what a version held; a scalar renders its
 * formatted value. An **unchanged** field shows a single value (only revealed
 * when the user expands the unchanged set); a **changed** field shows a
 * Current → Version {n} pair with a "Changed" badge — exactly what restoring
 * this version would put back.
 */
export function RevisionDiffRow({
    diff,
    revisionNumber,
    refs,
    media
}: {
    diff: RevisionFieldDiff;
    revisionNumber: number;
    /** Resolved relation records (undefined for non-relation fields). */
    refs?: DiffRelationRefs;
    /** Resolved media assets (undefined for non-media fields). */
    media?: DiffMediaRefs;
}) {
    const intl = useIntl();
    const label = fieldLabel(diff);
    const isRelation = diff.field.type === CONTENT_FIELD_TYPE.Relation;
    const isMedia = diff.field.type === CONTENT_FIELD_TYPE.Media;

    const render = (side: 'current' | 'revision'): ReactNode => {
        if (isRelation) {
            const list = refs?.[side] ?? [];
            const total =
                (side === 'current'
                    ? refs?.currentTotal
                    : refs?.revisionTotal) ?? list.length;
            return <RelationRefList refs={list} total={total} />;
        }
        // Only when the server resolved that side's assets. It omits a field
        // whose snapshot value was empty (so the row falls through to the muted
        // "Empty"), and omits media entirely when no media plugin is bound —
        // where printing the stored value beats claiming there are no assets.
        const assets = isMedia ? media?.[side] : undefined;
        if (assets) return <MediaRefList refs={assets} />;
        return formatRevisionValue(
            diff.field,
            side === 'current' ? diff.current : diff.revision,
            intl
        );
    };

    if (!diff.changed) {
        return (
            <div className="py-3">
                <p className="text-sm font-medium">{label}</p>
                <div className="mt-1 text-sm text-muted-foreground">
                    {render('current')}
                </div>
            </div>
        );
    }

    return (
        <div className="py-3">
            <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{label}</p>
                <Badge variant="warning">
                    {intl.formatMessage(messages.changed)}
                </Badge>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border border-border/60 bg-muted/40 p-2">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {intl.formatMessage(messages.current)}
                    </p>
                    <div className="text-sm">{render('current')}</div>
                </div>
                <div className="rounded-md border border-primary/30 bg-primary/5 p-2">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-primary">
                        {intl.formatMessage(messages.version, {
                            n: revisionNumber
                        })}
                    </p>
                    <div className="text-sm">{render('revision')}</div>
                </div>
            </div>
        </div>
    );
}
