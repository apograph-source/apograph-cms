import { defineMessages, useIntl } from 'react-intl';
import { FilePlus, FileText, Plus, Table2, X } from 'lucide-react';
import { Badge, Button, cn } from '@orthacms/design-system';
import type { RouteContext } from '../../application/readRouteContext';

const messages = defineMessages({
    add: {
        id: 'copilot.context.add',
        defaultMessage: 'Add this page as context'
    },
    addShort: {
        id: 'copilot.context.addShort',
        defaultMessage: 'Add context'
    },
    update: {
        id: 'copilot.context.update',
        defaultMessage: 'Attach the page you are on now instead'
    },
    remove: {
        id: 'copilot.context.remove',
        defaultMessage: 'Remove context'
    },
    entry: {
        id: 'copilot.context.entry',
        defaultMessage: '{type} entry'
    },
    records: {
        id: 'copilot.context.records',
        defaultMessage: '{type} list'
    },
    create: {
        id: 'copilot.context.create',
        defaultMessage: 'New {type}'
    }
});

export interface ContextChipProps {
    /** Where the user is now, from the URL. */
    current: RouteContext;
    /** What is attached to the next turn, or `null` for nothing. */
    attached: RouteContext | null;
    /** Attach the current page. */
    onAttach(): void;
    /** Detach whatever is attached. */
    onDetach(): void;
    /**
     * Extra classes on the row. The default gutter matches the transcript's, so
     * the chip lines up with the messages above it; a surface that has already
     * padded its own column passes `px-0`.
     */
    className?: string;
}

/** Two contexts point at the same thing. */
function sameTarget(a: RouteContext | null, b: RouteContext | null): boolean {
    return (
        a?.contentType === b?.contentType &&
        a?.entryId === b?.entryId &&
        a?.locale === b?.locale
    );
}

/**
 * The context attached to the next turn — **opt-in**.
 *
 * Attaching automatically from the URL was the first version, and it was wrong:
 * it made every question look like it was about whatever page happened to be
 * open. Ask "how many authors are there?" from the Articles list and the model
 * is told you are looking at articles, which is at best noise and at worst a
 * wrong steer. Explicit attachment also matches what the user can *see* — a
 * chip they added is one they can remove.
 *
 * Renders nothing where there is no page-level context to offer (outside the
 * content library), rather than an inert button.
 */
export function ContextChip({
    current,
    attached,
    onAttach,
    onDetach,
    className
}: ContextChipProps) {
    const intl = useIntl();

    const canAttachCurrent = !!current.contentType;
    // Offer the button when nothing is attached, or when the user has navigated
    // somewhere else since attaching — an attached context is a snapshot, and a
    // stale one should be replaceable without first removing it.
    const offerAttach = canAttachCurrent && !sameTarget(current, attached);

    if (!attached && !offerAttach) {
        return null;
    }

    return (
        <div
            className={cn(
                // `px-4`, matching the transcript's scroller and the composer:
                // the chip, the messages and the input box are one column, and
                // three different gutters read as a wobble down the edge.
                'flex flex-wrap items-center gap-1.5 px-4 py-2',
                className
            )}
        >
            {attached && (
                <Badge variant="secondary" className="gap-1 pr-1 font-normal">
                    {attached.surface === 'entry' ? (
                        <FileText className="size-3" />
                    ) : attached.surface === 'create' ? (
                        <FilePlus className="size-3" />
                    ) : (
                        <Table2 className="size-3" />
                    )}
                    {intl.formatMessage(
                        // The create form says so. Attached from `/new` the
                        // chip used to read "{type} list", which described a
                        // page the person was not on.
                        attached.surface === 'entry'
                            ? messages.entry
                            : attached.surface === 'create'
                              ? messages.create
                              : messages.records,
                        { type: attached.contentType }
                    )}
                    {attached.locale && (
                        <span className="uppercase">· {attached.locale}</span>
                    )}
                    <button
                        type="button"
                        onClick={onDetach}
                        aria-label={intl.formatMessage(messages.remove)}
                        className="hover:bg-muted-foreground/20 ml-0.5 rounded-sm p-0.5"
                    >
                        <X className="size-3" />
                    </button>
                </Badge>
            )}

            {offerAttach && (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onAttach}
                    className="text-muted-foreground h-6 gap-1 px-1.5 text-xs"
                    title={intl.formatMessage(
                        attached ? messages.update : messages.add
                    )}
                >
                    <Plus className="size-3" />
                    {intl.formatMessage(messages.addShort)}
                </Button>
            )}
        </div>
    );
}
