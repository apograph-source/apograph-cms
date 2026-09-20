import { defineMessages, useIntl } from 'react-intl';
import {
    Container,
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from '@orthacms/design-system';
import { PackageOpen } from 'lucide-react';

/** Intl descriptors for the no-content-types state, co-located here. */
const messages = defineMessages({
    title: {
        id: 'content.library.emptyTitle',
        defaultMessage: 'No content types yet'
    },
    body: {
        id: 'content.library.emptyBody',
        defaultMessage:
            'Content types are defined in code. None are registered for this workspace yet.'
    }
});

/**
 * The content-library empty state, shown when the registry returns no content
 * types. Distinct from the error state.
 */
export function ContentLibraryEmpty() {
    const intl = useIntl();

    return (
        <Container className="py-8">
            <Empty>
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <PackageOpen />
                    </EmptyMedia>
                    {/* The page's `<h1>` — this state is the whole route
                        when the workspace was granted no content types
                        (`ORT-167`). */}
                    <EmptyTitle asChild>
                        <h1>{intl.formatMessage(messages.title)}</h1>
                    </EmptyTitle>
                    <EmptyDescription>
                        {intl.formatMessage(messages.body)}
                    </EmptyDescription>
                </EmptyHeader>
            </Empty>
        </Container>
    );
}
