import { defineMessages, useIntl } from 'react-intl';
import {
    Alert,
    AlertDescription,
    AlertTitle,
    Button,
    Container
} from '@orthacms/design-system';

/** Intl descriptors for the content-library load error, co-located here. */
const messages = defineMessages({
    heading: {
        id: 'content.library.error.heading',
        defaultMessage: 'Content Library'
    },
    title: {
        id: 'content.library.errorTitle',
        defaultMessage: 'Couldn’t load content types'
    },
    body: {
        id: 'content.library.errorBody',
        defaultMessage: 'Something went wrong. Please try again.'
    },
    retry: {
        id: 'content.library.retry',
        defaultMessage: 'Try again'
    }
});

type ContentLibraryErrorProps = {
    /** Refetch the content-type list. */
    onRetry: () => void;
};

/**
 * The content-library error state, shown when the schema list fails to load.
 * Distinct from the empty state so a failure never reads as "no content types".
 */
export function ContentLibraryError({ onRetry }: ContentLibraryErrorProps) {
    const intl = useIntl();

    return (
        <Container className="py-8">
            {/* The page's `<h1>`, visually hidden. A failed schema load replaces
                the whole route with this banner, and the banner is a status
                message rather than the page's heading — so this state was
                reporting no `<h1>` at all (`ORT-167`). */}
            <h1 className="sr-only">{intl.formatMessage(messages.heading)}</h1>
            <Alert role="alert">
                <AlertTitle>{intl.formatMessage(messages.title)}</AlertTitle>
                <AlertDescription className="flex flex-col items-start gap-3">
                    {intl.formatMessage(messages.body)}
                    <Button size="sm" variant="outline" onClick={onRetry}>
                        {intl.formatMessage(messages.retry)}
                    </Button>
                </AlertDescription>
            </Alert>
        </Container>
    );
}
