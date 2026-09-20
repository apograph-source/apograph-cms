import { useParams } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import {
    Container,
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from '@orthacms/design-system';
import { FileQuestion } from 'lucide-react';
import type { ContentType } from '../../../domain/types/contentType';
import {
    CONTENT_TYPE_KIND,
    ENTRY_MODE,
    TYPE_PARAM
} from '../../../domain/constants';
import { CollectionRecordsView } from '../CollectionRecordsView';
import { ContentEntryView } from '../ContentEntryView';

/** Intl descriptors for the selected-type view, co-located here. */
const messages = defineMessages({
    unknownTitle: {
        id: 'content.type.unknownTitle',
        defaultMessage: 'Unknown content type'
    },
    unknownBody: {
        id: 'content.type.unknownBody',
        defaultMessage: 'This content type doesn’t exist in this workspace.'
    }
});

type ContentTypeViewProps = {
    /** Every content type in the workspace, resolved by the `:typeName` param. */
    types: ContentType[];
    /** Render the collection's trash view (soft-deleted rows) instead of its list. */
    trashed?: boolean;
};

/**
 * The selected content type's pane, resolved from the `:typeName` route param
 * against the already-fetched catalogue (no re-fetch). A **collection** renders
 * the records table; a **single** (page) renders its one-entry form directly
 * ({@link ContentEntryView} in `single` mode). An unknown param renders a
 * distinct not-found state.
 */
export function ContentTypeView({
    types,
    trashed = false
}: ContentTypeViewProps) {
    const intl = useIntl();
    const typeName = useParams()[TYPE_PARAM];
    const type = types.find((candidate) => candidate.name === typeName);

    if (!type) {
        return (
            <Container className="py-8">
                <Empty>
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <FileQuestion />
                        </EmptyMedia>
                        <EmptyTitle>
                            {intl.formatMessage(messages.unknownTitle)}
                        </EmptyTitle>
                        <EmptyDescription>
                            {intl.formatMessage(messages.unknownBody)}
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            </Container>
        );
    }

    // Collections get the dynamic records table (or its trash view); a single
    // (one-entry page) opens straight into its entry form (resolving its one
    // row, or a blank create form when it has none). Trash applies to
    // collections only — a single has no records list.
    if (type.kind === CONTENT_TYPE_KIND.Collection) {
        return <CollectionRecordsView type={type} trashed={trashed} />;
    }

    return <ContentEntryView type={type} mode={ENTRY_MODE.Single} />;
}
