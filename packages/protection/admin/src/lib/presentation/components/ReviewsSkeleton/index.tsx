import { useIntl, defineMessages } from 'react-intl';
import { Container, Skeleton, SkeletonRegion } from '@orthacms/design-system';

const messages = defineMessages({
    loading: {
        id: 'protection.reviews.skeleton',
        defaultMessage: 'Loading reviews'
    }
});

/**
 * The route-level fallback for the lazily-loaded Reviews page.
 *
 * It sits at the top of `components/` rather than inside the page's folder
 * because it pairs with the **route**, not with the page: the page's own module
 * is exactly what has not arrived yet when this renders.
 */
export function ReviewsSkeleton() {
    const intl = useIntl();
    return (
        <Container>
            <SkeletonRegion label={intl.formatMessage(messages.loading)}>
                <Skeleton className="h-8 w-40" />
                <Skeleton className="mt-4 h-9 w-64" />
                <Skeleton className="mt-4 h-32 w-full" />
            </SkeletonRegion>
        </Container>
    );
}
