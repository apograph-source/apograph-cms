import type { RefObject } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@orthacms/design-system';
import type { PublishOutlook } from '../../../domain/types';

const messages = defineMessages({
    title: {
        id: 'protection.bypass.title',
        defaultMessage: 'Publish without review?'
    },
    body: {
        id: 'protection.bypass.body',
        defaultMessage:
            'This type is protected: it needs {required, plural, one {# approval} other {# approvals}}, and has {given}. You are publishing past the rule as an administrator.'
    },
    trail: {
        id: 'protection.bypass.trail',
        defaultMessage:
            'This will appear in the activity log as entry.publish_bypassed, with your name and the rule.'
    },
    cancel: { id: 'protection.bypass.cancel', defaultMessage: 'Cancel' },
    confirm: {
        id: 'protection.bypass.confirm',
        defaultMessage: 'Publish anyway'
    }
});

/**
 * The bypass dialog — a confirmation, and nothing to fill in.
 *
 * It belongs to this plugin and not to `content-admin` because everything it
 * says is protection's: which rule is in force, how far short the count is, and
 * what the log row will be called. Content only knows that a contribution
 * offered a way through — see `ENTRY_PUBLISH_GUARD_SLOT`.
 *
 * **There is no reason field.** Review notes and bypass reasons were removed
 * together: the log row names who published past which rule and how far short
 * it was, and a free-text box beside that was a second place for an
 * explanation that belongs with the people involved. What stays is the pause —
 * publishing past a rule is still something a person confirms, told beforehand
 * that it is logged.
 *
 * **It does not publish.** Confirming calls `onConfirm` and closes; the publish
 * itself is the editor's own, run through `ENTRY_PUBLISH_GUARD_SLOT`'s callback
 * — which is what saves the edits on screen first, creates the record on a
 * create form, and puts up the same busy cover and toasts an ordinary publish
 * gets.
 *
 * Focus trap comes from the Radix `Dialog`; focus return is taken over below.
 */
export function BypassDialog({
    open,
    onOpenChange,
    outlook,
    onConfirm,
    returnFocusTo
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The verdict being bypassed — its numbers are what the body states. */
    outlook: PublishOutlook;
    /** Publish past the rule. */
    onConfirm: () => void;
    /**
     * The control that opened this, so closing puts focus back on it.
     *
     * Radix restores focus to whatever it captured when the content mounted,
     * and that is not reliable here: the button belongs to `content-admin` and
     * is re-rendered as the verdict changes, so the node Radix holds can be one
     * React has already replaced — leaving focus on `<body>` and a keyboard user
     * at the top of the page.
     */
    returnFocusTo?: RefObject<HTMLElement | null>;
}) {
    const intl = useIntl();

    const confirm = () => {
        // Closed first: the publish puts the editor's busy cover up, and a
        // dialog left open above it would be one more layer over the result.
        onOpenChange(false);
        onConfirm();
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                onCloseAutoFocus={(event) => {
                    const target = returnFocusTo?.current;
                    // Focusing a detached node silently does nothing, which is
                    // worse than letting Radix try — so only take over when the
                    // trigger is certainly still there.
                    if (target?.isConnected) {
                        event.preventDefault();
                        target.focus();
                    }
                }}
            >
                <DialogHeader>
                    <DialogTitle>
                        {intl.formatMessage(messages.title)}
                    </DialogTitle>
                    <DialogDescription>
                        {intl.formatMessage(messages.body, {
                            required: outlook.required,
                            given: outlook.given
                        })}
                    </DialogDescription>
                </DialogHeader>

                {/* Said before the click, not after it. */}
                <p className="text-xs text-muted-foreground">
                    {intl.formatMessage(messages.trail)}
                </p>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        {intl.formatMessage(messages.cancel)}
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={confirm}
                    >
                        {intl.formatMessage(messages.confirm)}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
