import { defineMessages, useIntl } from 'react-intl';
import { Spinner } from '@ortha/design-system';
import type { ContentTypeDetail } from '../../../../../domain/types/contentType';
import { useEntryRevisions } from '../../../../../application/useEntryRevisions';
import { EntrySidebarSection } from '../../../EntrySidebarSection';
import { RevisionList } from '../RevisionList';

/** How many revisions the compact sidebar card shows; the rest live in History. */
const WIDGET_LIMIT = 5;

const messages = defineMessages({
    title: { id: 'content.revisions.widgetTitle', defaultMessage: 'Revisions' },
    empty: {
        id: 'content.revisions.widgetEmpty',
        defaultMessage: 'No versions yet.'
    },
    error: {
        id: 'content.revisions.widgetError',
        defaultMessage: 'Couldn’t load version history.'
    },
    more: {
        id: 'content.revisions.widgetMore',
        defaultMessage: '+{n} more in the History tab'
    }
});

/**
 * The right-rail **Revisions** section: a compact view of the entry's most recent
 * versions, each with its status and capture time, and a Restore action for
 * older ones. Full history (and the same actions) lives in the editor's History
 * tab. Rendered only for a saved entry — a create form has no history yet.
 */
export function RevisionWidget({
    typeName,
    entryId,
    schema
}: {
    typeName: string;
    entryId: string;
    /** The type's full field schema — threaded to the preview diff. */
    schema: ContentTypeDetail;
}) {
    const intl = useIntl();
    const { data, isLoading, isError } = useEntryRevisions(typeName, entryId);

    const items = data?.items ?? [];
    const overflow = (data?.total ?? 0) - Math.min(items.length, WIDGET_LIMIT);

    return (
        <EntrySidebarSection title={intl.formatMessage(messages.title)}>
            {isLoading ? (
                <div className="flex justify-center py-2">
                    <Spinner />
                </div>
            ) : isError ? (
                <p className="text-xs text-muted-foreground">
                    {intl.formatMessage(messages.error)}
                </p>
            ) : items.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                    {intl.formatMessage(messages.empty)}
                </p>
            ) : (
                <>
                    <RevisionList
                        typeName={typeName}
                        entryId={entryId}
                        schema={schema}
                        revisions={items.slice(0, WIDGET_LIMIT)}
                        compact
                    />
                    {overflow > 0 && (
                        <p className="pt-2 text-xs text-muted-foreground">
                            {intl.formatMessage(messages.more, { n: overflow })}
                        </p>
                    )}
                </>
            )}
        </EntrySidebarSection>
    );
}
