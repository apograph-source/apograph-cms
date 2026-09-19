import { defineMessages, useIntl } from 'react-intl';
import { CircleAlert, Sparkles } from 'lucide-react';
import { Alert, AlertDescription, Badge } from '@apograph/design-system';
import type { ChatProposal } from '../../domain/types/chat';

const messages = defineMessages({
    failed: {
        id: 'copilot.proposal.failed',
        defaultMessage: 'Not saved'
    },
    accepted: {
        id: 'copilot.proposal.accepted',
        defaultMessage: 'Saved'
    },
    rejected: {
        id: 'copilot.proposal.rejected',
        defaultMessage: 'Discarded'
    },
    empty: {
        id: 'copilot.proposal.empty',
        defaultMessage: '(empty)'
    },
    before: {
        id: 'copilot.proposal.before',
        defaultMessage: 'Was'
    },
    after: {
        id: 'copilot.proposal.after',
        defaultMessage: 'Now'
    },
    applied: {
        id: 'copilot.proposal.applied',
        defaultMessage: 'This change was saved to your content.'
    },
    notApplied: {
        id: 'copilot.proposal.notApplied',
        defaultMessage: 'Nothing was saved.'
    },
    failedGeneric: {
        id: 'copilot.proposal.failedGeneric',
        defaultMessage:
            'Apograph AI could not make this change, so your content is unchanged. Try asking again.'
    },
    reason: {
        id: 'copilot.proposal.reason',
        defaultMessage: 'Why this change was not saved'
    },
    wasRejected: {
        id: 'copilot.proposal.wasRejected',
        defaultMessage: 'This change was discarded.'
    }
});

/**
 * One change the copilot made, with its per-field diff — **a receipt**.
 *
 * It used to be the accept boundary: two buttons, and a decision that had not
 * been taken yet.
 * [ADR-0009](../../../../../../docs/adr/0009-copilot-applies-directly.md)
 * removed the human step, so by the time this renders the write has already
 * happened (or failed). Every word on it is past tense for that reason — a card
 * that still read "Needs your approval" would be describing a step that no
 * longer exists.
 *
 * **Its job is unchanged even though its buttons are gone: be unmistakable
 * about what happened.** With nothing pausing for review, this card is the only
 * place a user learns that their content changed — so "Saved" and "Not saved"
 * are stated in words, not implied by styling, and a failure shows the server's
 * own reason rather than a generic apology.
 *
 * The card lives in the transcript, attached to the turn that produced it,
 * because a change is part of an answer: "here is what I changed". A list
 * elsewhere would make the reply refer to something off-screen, and the reply
 * is where the reasoning is.
 */
export function ProposalCard({ proposal }: { proposal: ChatProposal }) {
    const intl = useIntl();
    // `pending` no longer means "waiting" — nothing waits. It means the apply
    // did not go through.
    const failed = proposal.status === 'pending';

    return (
        <section
            className="border-border bg-card rounded-lg border shadow-sm"
            // Named by its own summary: with several cards in a thread, "Change"
            // repeated four times tells a screen-reader user nothing.
            aria-label={proposal.summary}
        >
            <header className="flex items-start gap-2 px-3 pt-3">
                <Sparkles className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{proposal.summary}</p>
                    <p className="text-muted-foreground mt-0.5 font-mono text-[11px]">
                        {proposal.kind}
                    </p>
                </div>
                <StatusBadge status={proposal.status} />
            </header>

            {proposal.changes && proposal.changes.length > 0 && (
                <dl className="mt-3 divide-y border-t">
                    {proposal.changes.map((change) => (
                        <div key={change.field} className="px-3 py-2">
                            <dt className="text-muted-foreground text-[11px] font-medium">
                                {change.label ?? change.field}
                            </dt>
                            <dd className="mt-1 space-y-1 text-xs">
                                {/* `before` is absent on a create — there is
                                    nothing to replace, and printing an invented
                                    "—" would read as a field being cleared. */}
                                {'before' in change && (
                                    <ValueRow
                                        label={intl.formatMessage(
                                            messages.before
                                        )}
                                        value={change.before}
                                        muted
                                    />
                                )}
                                <ValueRow
                                    label={intl.formatMessage(messages.after)}
                                    value={change.after}
                                />
                            </dd>
                        </div>
                    ))}
                </dl>
            )}

            {/* Keyed off the status, not off `error` being present. A row
                reopened from a past thread may carry the failure without the
                message (older rows, or a reason that was never recorded), and a
                card that then showed the diff with no warning would read as
                though the change had gone through. */}
            {failed && (
                // `py-3`, not `pt-3`: with no bottom padding the alert butted
                // straight into the footer's rule, so the one block on the card
                // that says the change did not happen was the one drawn as
                // though it were part of the line below it.
                <div className="px-3 py-3">
                    <Alert variant="destructive">
                        {/* **The icon is not a direct child of the `Alert`,
                            deliberately.** The design system positions a
                            top-level `<svg>` absolutely (`left-4 top-4`) and
                            nudges the block beside it up 3px — geometry tuned
                            for an alert with a *title* over a description. This
                            one is a description alone, usually a single line,
                            so those rules put the icon near the top of the box
                            and the sentence off its centre. Wrapping the pair
                            in a flex row means none of the `[&>svg]` selectors
                            match, which is a local fix rather than a change to
                            the geometry every other alert in the admin is
                            drawn with.

                            That row is `items-start` with the icon nudged down
                            2px, **not** `items-center`. Centring was right
                            while the reason was always one line and wrong the
                            moment it can grow to the bound below: against a
                            14rem block the icon floats to the middle of the
                            box, pointing at whatever sentence happens to be
                            halfway down. The 2px is exactly the offset centring
                            gave it on one line — a 16px glyph in a 20px line —
                            so the short case, which is nearly every case, is
                            drawn unchanged and the tall one keeps the icon
                            beside the words it introduces. The same treatment
                            the card's own header gives `Sparkles`. */}
                        <div className="flex items-start gap-2">
                            <CircleAlert
                                aria-hidden
                                className="text-destructive mt-0.5 size-4 shrink-0"
                            />
                            {/* **Bounded, for the same reason the tool step's
                                payload is** (`ToolStep`'s `<pre>`, `max-h-56`):
                                this text is the server's, not ours, and a
                                failure that enumerates twenty fields would
                                otherwise make the alert taller than the card
                                and push the diff and the "Not saved" badge off
                                the top of the screen — leaving the reader
                                scrolling through an explanation of a change
                                they can no longer see. `max-h` reserves
                                nothing, so a one-line reason is still one line
                                with no scrollbar and no empty space under it.

                                Focusable because it scrolls: overflow a
                                keyboard-only user cannot reach is half a reason
                                (2.1.1) — the same pairing `PermissionPrompt`'s
                                arguments and the markdown renderer's code
                                blocks already carry. `group` rather than
                                `region`: this is a few sentences inside a
                                banner, not an area of the page, and one
                                landmark per failed card would bury the real
                                ones. It is named because a tab stop announced
                                as nothing tells the reader only that focus
                                moved. */}
                            <AlertDescription
                                role="group"
                                aria-label={intl.formatMessage(messages.reason)}
                                tabIndex={0}
                                className="focus-visible:ring-ring max-h-56 min-w-0 flex-1 overflow-auto break-words focus-visible:ring-2 focus-visible:outline-none"
                            >
                                {proposal.error ??
                                    intl.formatMessage(messages.failedGeneric)}
                            </AlertDescription>
                        </div>
                    </Alert>
                </div>
            )}

            {/* **Omitted when a failure carried its own reason**, because the
                two would contradict each other. "Nothing was saved." is right
                for a change that never started, and wrong for one that stopped
                halfway — a batch reports "the first 3 were saved and the rest
                were not", and a flat denial underneath it is the sentence a
                user believes. The alert above already states the outcome, so
                the footer stands down rather than restating it. */}
            {!(failed && proposal.error) && (
                <footer className="flex items-center gap-2 border-t px-3 py-2">
                    <span className="text-muted-foreground text-[11px]">
                        {proposal.status === 'accepted'
                            ? intl.formatMessage(messages.applied)
                            : proposal.status === 'rejected'
                              ? intl.formatMessage(messages.wasRejected)
                              : intl.formatMessage(messages.notApplied)}
                    </span>
                </footer>
            )}
        </section>
    );
}

function StatusBadge({ status }: { status: ChatProposal['status'] }) {
    const intl = useIntl();
    if (status === 'accepted') {
        return (
            <Badge variant="secondary">
                {intl.formatMessage(messages.accepted)}
            </Badge>
        );
    }
    if (status === 'rejected') {
        return (
            <Badge variant="outline">
                {intl.formatMessage(messages.rejected)}
            </Badge>
        );
    }
    // `destructive`, not the neutral default it had as "pending": a change the
    // user was told about but which never landed is a failure, and the badge is
    // what they read first.
    return (
        <Badge variant="destructive">
            {intl.formatMessage(messages.failed)}
        </Badge>
    );
}

/**
 * One side of a field's diff.
 *
 * Rendered as **text**, never as markup: a proposed value is content the model
 * produced from content the workspace authored, and this card is where a human
 * decides on it — the one place it must be impossible for it to render as
 * anything but characters.
 */
function ValueRow({
    label,
    value,
    muted
}: {
    label: string;
    value: unknown;
    muted?: boolean;
}) {
    const intl = useIntl();
    const empty = value === null || value === undefined || value === '';
    return (
        <div className="flex gap-2">
            <span className="text-muted-foreground w-10 shrink-0 text-[10px] tracking-wide uppercase">
                {label}
            </span>
            <span
                className={[
                    'min-w-0 flex-1 break-words whitespace-pre-wrap',
                    muted ? 'text-muted-foreground line-through' : '',
                    empty ? 'text-muted-foreground italic' : ''
                ]
                    .filter(Boolean)
                    .join(' ')}
            >
                {empty ? intl.formatMessage(messages.empty) : display(value)}
            </span>
        </div>
    );
}

/** A value as a person reads it — scalars plain, anything else as JSON. */
function display(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    try {
        return JSON.stringify(value) ?? '';
    } catch {
        return String(value);
    }
}
