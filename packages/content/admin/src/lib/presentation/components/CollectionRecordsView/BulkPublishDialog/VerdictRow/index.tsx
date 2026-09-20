import { defineMessages, useIntl } from 'react-intl';
import {
    AlertCircle,
    Check,
    CheckCircle2,
    ChevronRight,
    ExternalLink,
    MinusCircle,
    X,
    XCircle
} from 'lucide-react';
import {
    buttonVariants,
    cn,
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from '@orthacms/design-system';
import type { BulkPublishVerdict } from '../../../../../domain/types/contentType';
import { BULK_VERDICT } from '../../../../../domain/constants';

const messages = defineMessages({
    willPublish: {
        id: 'content.bulkPublish.willPublish',
        defaultMessage: 'Will publish'
    },
    alreadyPublished: {
        id: 'content.bulkPublish.alreadyPublished',
        defaultMessage: 'Already published'
    },
    notFound: {
        id: 'content.bulkPublish.notFound',
        defaultMessage: 'No longer available'
    },
    blocked: {
        id: 'content.bulkPublish.blocked',
        defaultMessage: '{count, plural, one {# issue} other {# issues}}'
    },
    openRecord: {
        id: 'content.bulkPublish.openRecord',
        defaultMessage: 'Open record in a new tab'
    },
    toggleIssues: {
        id: 'content.bulkPublish.toggleIssues',
        defaultMessage: 'Show field checks'
    }
});

/**
 * One verdict as a collapsible row in {@link BulkPublishDialog}: a header showing
 * the record's title + id, a status icon, the verdict note, and an "open in a new
 * tab" button. Any record the server gated (publishable, blocked, or
 * already-published) expands to its per-field publish-gate checklist — passed
 * fields included, not just failures; only a vanished (not-found) row can't expand.
 */
export function VerdictRow({
    item,
    name,
    recordHref
}: {
    item: BulkPublishVerdict;
    /**
     * Name this row by something other than the record's title. A set of locale
     * siblings is all one record, so the title repeats down every row and the
     * locale is the only thing that tells them apart.
     */
    name?: string;
    /** Builds the entry-editor URL for a record id. */
    recordHref: (id: string) => string;
}) {
    const intl = useIntl();

    const meta = {
        [BULK_VERDICT.Publishable]: {
            icon: <CheckCircle2 className="size-4 text-primary" aria-hidden />,
            note: intl.formatMessage(messages.willPublish),
            danger: false
        },
        [BULK_VERDICT.AlreadyPublished]: {
            icon: (
                <MinusCircle
                    className="size-4 text-muted-foreground"
                    aria-hidden
                />
            ),
            note: intl.formatMessage(messages.alreadyPublished),
            danger: false
        },
        [BULK_VERDICT.NotFound]: {
            icon: (
                <AlertCircle
                    className="size-4 text-muted-foreground"
                    aria-hidden
                />
            ),
            note: intl.formatMessage(messages.notFound),
            danger: false
        },
        [BULK_VERDICT.Blocked]: {
            icon: <XCircle className="size-4 text-destructive" aria-hidden />,
            note: intl.formatMessage(messages.blocked, {
                count: item.issues.length
            }),
            danger: true
        }
    }[item.verdict];

    // Any gated record (publishable, blocked, or already-published) carries a
    // per-field checklist; expand to show it — passed fields included, not just
    // failures. Only a not-found row has none.
    const hasChecks = item.checks.length > 0;
    // The record may have vanished (NotFound) — nothing to open in that case.
    const canOpen = item.verdict !== BULK_VERDICT.NotFound;

    const header = (
        <div className="flex items-center gap-2 px-3 py-2">
            {hasChecks ? (
                <CollapsibleTrigger
                    className="group flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={intl.formatMessage(messages.toggleIssues)}
                >
                    <ChevronRight
                        className="size-4 transition-transform group-data-[state=open]:rotate-90"
                        aria-hidden
                    />
                </CollapsibleTrigger>
            ) : (
                <span className="size-6 shrink-0" aria-hidden />
            )}
            <span className="shrink-0">{meta.icon}</span>
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{name ?? item.title}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                    {item.id}
                </p>
            </div>
            <span
                className={cn(
                    'shrink-0 text-xs',
                    meta.danger ? 'text-destructive' : 'text-muted-foreground'
                )}
            >
                {meta.note}
            </span>
            {canOpen && (
                <a
                    href={recordHref(item.id)}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                        buttonVariants({ variant: 'ghost', size: 'icon' }),
                        'size-7 shrink-0 text-muted-foreground'
                    )}
                    aria-label={intl.formatMessage(messages.openRecord)}
                >
                    <ExternalLink className="size-4" aria-hidden />
                </a>
            )}
        </div>
    );

    if (!hasChecks) {
        return <li className="rounded-lg border bg-background">{header}</li>;
    }

    return (
        <li className="rounded-lg border bg-background">
            <Collapsible>
                {header}
                <CollapsibleContent>
                    <ul className="mb-3 ml-11 mr-3 flex flex-col gap-1.5">
                        {item.checks.map((check) => (
                            <li
                                key={check.field}
                                className="flex items-start gap-1.5 text-xs"
                            >
                                {check.ok ? (
                                    <Check
                                        className="mt-0.5 size-3.5 shrink-0 text-primary"
                                        aria-hidden
                                    />
                                ) : (
                                    <X
                                        className="mt-0.5 size-3.5 shrink-0 text-destructive"
                                        aria-hidden
                                    />
                                )}
                                <span
                                    className={
                                        check.ok
                                            ? 'text-muted-foreground'
                                            : 'text-destructive'
                                    }
                                >
                                    <span className="font-medium">
                                        {check.label}
                                    </span>
                                    {!check.ok && check.message
                                        ? `: ${check.message}`
                                        : null}
                                </span>
                            </li>
                        ))}
                    </ul>
                </CollapsibleContent>
            </Collapsible>
        </li>
    );
}
