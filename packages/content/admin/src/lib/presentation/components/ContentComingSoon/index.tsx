import type { ComponentType } from 'react';
import {
    Container,
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from '@orthacms/design-system';

type ContentComingSoonProps = {
    /** Illustrative icon for the empty state. */
    icon: ComponentType<{ className?: string }>;
    /** Heading. */
    title: string;
    /** Supporting copy. */
    description: string;
};

/**
 * A generic placeholder pane for content-library views that aren't built yet
 * (e.g. History, Trash) — an `Empty` state with an icon, title, and description.
 */
export function ContentComingSoon({
    icon: Icon,
    title,
    description
}: ContentComingSoonProps) {
    return (
        <Container className="py-8">
            <Empty>
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <Icon />
                    </EmptyMedia>
                    <EmptyTitle>{title}</EmptyTitle>
                    <EmptyDescription>{description}</EmptyDescription>
                </EmptyHeader>
            </Empty>
        </Container>
    );
}
