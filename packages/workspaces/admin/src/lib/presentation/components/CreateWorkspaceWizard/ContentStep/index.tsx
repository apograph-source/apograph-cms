import { useMemo } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { AlertCircle, Database, FileText } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@orthacms/design-system';
import { useContentTypes } from '../../../../application/useContentTypes';
import { ContentTypesSkeleton } from '../../WorkspacesSkeleton';
import type {
    ContentMode,
    ResourceSelection
} from '../../../../domain/types/wizard';
import { ModeTiles } from './ModeTiles';
import {
    ResourceSection,
    type ResourceSectionMessages
} from './ResourceSection';

const messages = defineMessages({
    errorTitle: {
        id: 'workspaces.create.content.errorTitle',
        defaultMessage: 'Could not load content types'
    },
    errorBody: {
        id: 'workspaces.create.content.errorBody',
        defaultMessage:
            'Try again in a moment, or skip this step and grant content access later.'
    },
    allAlertTitle: {
        id: 'workspaces.create.content.allAlertTitle',
        defaultMessage: 'Full access'
    },
    allAlertBody: {
        id: 'workspaces.create.content.allAlertBody',
        defaultMessage:
            'This workspace can access every collection and page, including any added later.'
    }
});

const collectionMessages: ResourceSectionMessages = defineMessages({
    heading: {
        id: 'workspaces.create.content.collectionsHeading',
        defaultMessage: 'Collections'
    },
    help: {
        id: 'workspaces.create.content.collectionsHelp',
        defaultMessage:
            'Structured content types — e.g. blog posts, products, authors.'
    },
    searchPlaceholder: {
        id: 'workspaces.create.content.collectionsSearch',
        defaultMessage: 'Search collections by name'
    },
    allLabel: {
        id: 'workspaces.create.content.collectionsAll',
        defaultMessage: 'All collections'
    },
    empty: {
        id: 'workspaces.create.content.collectionsEmpty',
        defaultMessage: 'No collections defined yet.'
    },
    noResults: {
        id: 'workspaces.create.content.collectionsNoResults',
        defaultMessage: 'No collections match your search.'
    },
    countSpecific: {
        id: 'workspaces.create.content.collectionsCountSpecific',
        defaultMessage:
            '{count, plural, =0 {No collections selected} one {# collection selected} other {# collections selected}}'
    },
    countAll: {
        id: 'workspaces.create.content.collectionsCountAll',
        defaultMessage: 'All collections selected'
    },
    countAllExcluded: {
        id: 'workspaces.create.content.collectionsCountAllExcluded',
        defaultMessage:
            'All collections selected — {count, plural, one {# excluded} other {# excluded}}'
    }
});

const pageMessages: ResourceSectionMessages = defineMessages({
    heading: {
        id: 'workspaces.create.content.pagesHeading',
        defaultMessage: 'Pages'
    },
    help: {
        id: 'workspaces.create.content.pagesHelp',
        defaultMessage: 'Standalone pages — e.g. home, about, contact.'
    },
    searchPlaceholder: {
        id: 'workspaces.create.content.pagesSearch',
        defaultMessage: 'Search pages by name or path'
    },
    allLabel: {
        id: 'workspaces.create.content.pagesAll',
        defaultMessage: 'All pages'
    },
    empty: {
        id: 'workspaces.create.content.pagesEmpty',
        defaultMessage: 'No pages defined yet.'
    },
    noResults: {
        id: 'workspaces.create.content.pagesNoResults',
        defaultMessage: 'No pages match your search.'
    },
    countSpecific: {
        id: 'workspaces.create.content.pagesCountSpecific',
        defaultMessage:
            '{count, plural, =0 {No pages selected} one {# page selected} other {# pages selected}}'
    },
    countAll: {
        id: 'workspaces.create.content.pagesCountAll',
        defaultMessage: 'All pages selected'
    },
    countAllExcluded: {
        id: 'workspaces.create.content.pagesCountAllExcluded',
        defaultMessage:
            'All pages selected — {count, plural, one {# excluded} other {# excluded}}'
    }
});

/** Props for {@link ContentStep}. */
export type ContentStepProps = {
    /** Page-level content mode. */
    contentMode: ContentMode;
    /** Set the content mode. */
    setContentMode: (mode: ContentMode) => void;
    /** Collection selection. */
    collections: ResourceSelection;
    /** Replace the collection selection. */
    setCollections: (selection: ResourceSelection) => void;
    /** Page selection. */
    pages: ResourceSelection;
    /** Replace the page selection. */
    setPages: (selection: ResourceSelection) => void;
};

/**
 * The content step body: the All-vs-Specific mode tiles, then either a
 * reassuring full-access alert or the collections + pages selection panels
 * (with loading and error states for the content-types query).
 */
export function ContentStep({
    contentMode,
    setContentMode,
    collections,
    setCollections,
    pages,
    setPages
}: ContentStepProps) {
    const intl = useIntl();
    const query = useContentTypes();
    const allTypes = useMemo(() => query.data ?? [], [query.data]);

    const collectionRows = useMemo(
        () =>
            allTypes
                .filter((ct) => ct.kind === 'collection')
                .map((ct) => ({
                    id: ct.name,
                    primary: ct.label ?? ct.name,
                    secondary: ct.description
                })),
        [allTypes]
    );
    const pageRows = useMemo(
        () =>
            allTypes
                .filter((ct) => ct.kind === 'single')
                .map((ct) => ({
                    id: ct.name,
                    primary: ct.label ?? ct.name,
                    secondary: ct.path ?? ct.description
                })),
        [allTypes]
    );

    return (
        <div className="flex flex-col gap-6">
            <ModeTiles value={contentMode} onChange={setContentMode} />

            {contentMode === 'all' ? (
                <Alert>
                    <AlertTitle>
                        {intl.formatMessage(messages.allAlertTitle)}
                    </AlertTitle>
                    <AlertDescription>
                        {intl.formatMessage(messages.allAlertBody)}
                    </AlertDescription>
                </Alert>
            ) : query.isPending ? (
                <ContentTypesSkeleton />
            ) : query.isError ? (
                <Alert variant="destructive">
                    <AlertCircle className="size-4" />
                    <AlertTitle>
                        {intl.formatMessage(messages.errorTitle)}
                    </AlertTitle>
                    <AlertDescription>
                        {intl.formatMessage(messages.errorBody)}
                    </AlertDescription>
                </Alert>
            ) : (
                <div className="flex flex-col gap-6">
                    <ResourceSection
                        messages={collectionMessages}
                        icon={Database}
                        rows={collectionRows}
                        selection={collections}
                        onChange={setCollections}
                    />
                    <ResourceSection
                        messages={pageMessages}
                        icon={FileText}
                        rows={pageRows}
                        selection={pages}
                        onChange={setPages}
                    />
                </div>
            )}
        </div>
    );
}
