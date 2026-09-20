import { defineMessages, useIntl } from 'react-intl';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Spinner
} from '@ortha/design-system';
import type { ContentTypeDetail } from '../../../../../domain/types/contentType';
import { useEntryRevisions } from '../../../../../application/useEntryRevisions';
import { RevisionList } from '../RevisionList';

const messages = defineMessages({
    title: { id: 'content.revisions.historyTitle', defaultMessage: 'History' },
    body: {
        id: 'content.revisions.historyBody',
        defaultMessage:
            'Every save is kept as a version. Restore an earlier one to bring it back — it’s re-applied as a new revision, so nothing is lost.'
    },
    unsaved: {
        id: 'content.revisions.historyUnsaved',
        defaultMessage: 'Save this record to start its version history.'
    },
    empty: {
        id: 'content.revisions.historyEmpty',
        defaultMessage: 'No versions yet.'
    },
    error: {
        id: 'content.revisions.historyError',
        defaultMessage: 'Couldn’t load version history.'
    }
});

/**
 * The **History** tab: the entry's full version timeline (a {@link RevisionList}
 * over the cached revisions query) — the **one** place an entry's versions are
 * read, previewed and restored from. The rail used to carry a truncated second
 * copy of the same list; a create form has no id yet, so it prompts the user to
 * save first.
 */
export function HistoryTimeline({
    typeName,
    entryId,
    schema
}: {
    typeName: string;
    entryId?: string;
    /** The type's full field schema — threaded to the preview diff. */
    schema: ContentTypeDetail;
}) {
    const intl = useIntl();
    const { data, isLoading, isError } = useEntryRevisions(typeName, entryId);
    const items = data?.items ?? [];

    return (
        <Card className="shadow-none">
            <CardHeader>
                <CardTitle className="text-base">
                    {intl.formatMessage(messages.title)}
                </CardTitle>
                <CardDescription>
                    {intl.formatMessage(messages.body)}
                </CardDescription>
            </CardHeader>
            <CardContent>
                {!entryId ? (
                    <p className="text-sm text-muted-foreground">
                        {intl.formatMessage(messages.unsaved)}
                    </p>
                ) : isLoading ? (
                    <div className="flex justify-center py-4">
                        <Spinner />
                    </div>
                ) : isError ? (
                    <p className="text-sm text-muted-foreground">
                        {intl.formatMessage(messages.error)}
                    </p>
                ) : items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        {intl.formatMessage(messages.empty)}
                    </p>
                ) : (
                    <RevisionList
                        typeName={typeName}
                        entryId={entryId}
                        schema={schema}
                        revisions={items}
                    />
                )}
            </CardContent>
        </Card>
    );
}
