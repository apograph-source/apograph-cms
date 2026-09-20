import { defineMessages, useIntl } from 'react-intl';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@orthacms/design-system';

/** Intl descriptors for the sidebar's content-type load error, co-located. */
const messages = defineMessages({
    heading: {
        id: 'content.sidebar.heading',
        defaultMessage: 'Content'
    },
    title: {
        id: 'content.sidebar.errorTitle',
        defaultMessage: 'Couldn’t load content types'
    },
    retry: {
        id: 'content.sidebar.retry',
        defaultMessage: 'Try again'
    }
});

type ContentSidebarErrorProps = {
    /** Refetch the content-type catalogue. */
    onRetry: () => void;
    /** Extra classes for the root element (mirrors {@link ContentSidebar}). */
    className?: string;
};

/**
 * The Content section's **error** state in the app sidebar.
 *
 * Without it the section's only failure mode was `return null` — the whole
 * Content nav vanished silently while the work-area pane showed a proper error
 * card, so a reader saw a workspace that looked like it had no content types at
 * all. Rendered as an `alert` so the disappearance is announced rather than
 * merely visible, with the same retry the pane offers.
 */
export function ContentSidebarError({
    onRetry,
    className
}: ContentSidebarErrorProps) {
    const intl = useIntl();

    return (
        <div className={className}>
            <div className="flex flex-col gap-2 p-2">
                <h2 className="px-2 text-sm font-semibold tracking-[-0.01em]">
                    {intl.formatMessage(messages.heading)}
                </h2>
                <div
                    role="alert"
                    className="flex flex-col items-start gap-2 rounded-md border border-sidebar-border px-2.5 py-2 text-sm text-sidebar-foreground/80"
                >
                    <span className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                        <span>{intl.formatMessage(messages.title)}</span>
                    </span>
                    {/* The primary treatment, not the pane's `outline`: an
                        outline button's card background does not carry enough
                        contrast against the sidebar's own surface. */}
                    <Button size="sm" onClick={onRetry}>
                        {intl.formatMessage(messages.retry)}
                    </Button>
                </div>
            </div>
        </div>
    );
}
