import { useCallback, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import type {
    EntryPublishGuardState,
    EntryPublishOptions,
    EntryPublishVerdict,
    EntrySlotContext
} from '@apograph/content-admin';
import type { PublishOutlook } from '../../../domain/types';
import {
    reviewScopeOf,
    useEntryReview,
    useNewEntryProtection
} from '../../../application/hooks';
import { BypassDialog } from '../../components/BypassDialog';

const messages = defineMessages({
    short: {
        id: 'protection.guard.short',
        defaultMessage:
            '{required, plural, one {# approval} other {# approvals}} required on this version, {given} given.'
    },
    afterSave: {
        id: 'protection.guard.afterSave',
        defaultMessage:
            'Saving your changes starts a new version: {required, plural, one {# approval} other {# approvals}} required, {given} would count.'
    },
    newEntry: {
        id: 'protection.guard.newEntry',
        defaultMessage:
            '{required, plural, one {# approval} other {# approvals}} required before a new entry of this type can be published.'
    }
});

/**
 * What protection tells the entry editor's publish button.
 *
 * A **hook**, per `ENTRY_PUBLISH_GUARD_SLOT`: it is called unconditionally in
 * slot order on every render of `EntryActions`, so it may hold state — which is
 * what lets the bypass dialog's open flag live here rather than in content.
 *
 * **It answers for the version Publish will actually ship.** Publish saves
 * whatever is unsaved first, and on a create form it creates the entry — both
 * write a version no approval is bound to, authored by the person pressing it.
 * So there are three reads, and each comes computed from the server's kernel:
 * the stored head's verdict for a clean editor, `afterSave` for a dirty one, and
 * the type's new-entry verdict for a create form. Reading only the head made the
 * button offer an ordinary publish that the API then refused.
 *
 * Where an administrator may bypass, the button stays an ordinary **Publish**
 * and the click opens the confirmation; confirming goes back through the
 * editor's own publish, so the edits on screen are saved with it.
 *
 * It returns `null` — no opinion — whenever protection has nothing to say: a
 * non-publishable type, an unprotected one, and while the read is still in
 * flight or has failed. That last one matters: a guard that blocked on a failed
 * read would make an unreachable API look like a refused publish, and the person
 * could not tell the two apart. The server refuses the publish regardless, with
 * the reason, so the honest client-side default is silence.
 */
export function usePublishProtectionVerdict(
    context: EntrySlotContext,
    { dirty }: EntryPublishGuardState
): EntryPublishVerdict | null {
    const intl = useIntl();
    const [bypassOpen, setBypassOpen] = useState(false);
    const scope = reviewScopeOf(context);
    const { data: review } = useEntryReview(scope);
    const creating = context.isCreate && !!context.schema.publishable;
    const { data: fresh } = useNewEntryProtection(
        context.workspaceId,
        context.schema.name,
        creating
    );

    /**
     * The control that opened the dialog, so closing it can put focus back.
     *
     * Radix restores focus to whatever it captured when the content mounted,
     * and that is not reliable here: the button belongs to `content-admin` and
     * is re-rendered as this verdict changes, so the element Radix is holding
     * can be a node React has since replaced — leaving focus on `<body>` and a
     * keyboard user at the top of the page. Capturing the trigger ourselves, at
     * the moment of the click, is the only reference that is certainly right.
     */
    const trigger = useRef<HTMLElement | null>(null);

    /** The editor's publish, handed over with the click that opened the dialog. */
    const publish = useRef<((options: EntryPublishOptions) => void) | null>(
        null
    );

    const closeBypass = useCallback((open: boolean) => setBypassOpen(open), []);
    const confirmBypass = useCallback(() => {
        publish.current?.({ bypass: true });
    }, []);

    let outlook: PublishOutlook | null = null;
    let message = messages.short;
    if (scope) {
        if (review?.protected) {
            outlook = dirty ? review.afterSave : review;
            if (dirty) message = messages.afterSave;
        }
    } else if (creating && fresh?.protected) {
        outlook = fresh;
        message = messages.newEntry;
    }

    if (!outlook) return null;

    if (!outlook.blocked) return { blocked: false };

    const reason = intl.formatMessage(message, {
        required: outlook.required,
        given: outlook.given
    });

    if (!outlook.bypassable) return { blocked: true, reason };

    return {
        blocked: true,
        reason,
        action: {
            onSelect: (publishWith) => {
                const active = document.activeElement;
                trigger.current = active instanceof HTMLElement ? active : null;
                publish.current = publishWith;
                setBypassOpen(true);
            }
        },
        // Rendered outside the actions cluster by content, which is what keeps
        // it mounted while the button it hangs off is re-rendered as the
        // verdict changes.
        overlay: (
            <BypassDialog
                open={bypassOpen}
                onOpenChange={closeBypass}
                outlook={outlook}
                onConfirm={confirmBypass}
                returnFocusTo={trigger}
            />
        )
    };
}
