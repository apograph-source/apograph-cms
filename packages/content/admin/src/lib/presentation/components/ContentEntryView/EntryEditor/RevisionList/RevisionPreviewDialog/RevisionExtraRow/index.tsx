import { defineMessages, useIntl } from 'react-intl';
import { Badge } from '@orthacms/design-system';
import type { RevisionExtraItem } from '../../../../../../slots/contentSlots';

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

/**
 * One **plugin-owned** row in the revision preview — state a version captured
 * outside the values bag (`RevisionSnapshot.extra`), rendered in exactly the
 * layout a field row uses.
 *
 * A deliberate near-duplicate of `RevisionDiffRow`'s markup rather than a shared
 * base: that component is about a `ContentField` — its label, its type switch,
 * its resolved relation and media refs — and none of that applies here. Merging
 * them would mean a component with two disjoint halves and a discriminator, to
 * save a grid.
 */
export function RevisionExtraRow({
    item,
    changed,
    current,
    revision,
    revisionNumber
}: {
    /** The contributing slot item — supplies the label and the value renderer. */
    item: RevisionExtraItem;
    /** Whether the two versions differ here (decided by content, not the item). */
    changed: boolean;
    /** The baseline (latest / live) version's value. */
    current: unknown;
    /** The previewed version's value. */
    revision: unknown;
    /** The previewed version's number, for the right-hand column's heading. */
    revisionNumber: number;
}) {
    const intl = useIntl();
    const label = intl.formatMessage(item.label);
    const { Component } = item;

    if (!changed) {
        return (
            <div className="py-3">
                <p className="text-sm font-medium">{label}</p>
                <div className="mt-1 text-sm text-muted-foreground">
                    <Component value={current} />
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
                    <div className="text-sm">
                        <Component value={current} />
                    </div>
                </div>
                <div className="rounded-md border border-primary/30 bg-primary/5 p-2">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-primary">
                        {intl.formatMessage(messages.version, {
                            n: revisionNumber
                        })}
                    </p>
                    <div className="text-sm">
                        <Component value={revision} />
                    </div>
                </div>
            </div>
        </div>
    );
}
