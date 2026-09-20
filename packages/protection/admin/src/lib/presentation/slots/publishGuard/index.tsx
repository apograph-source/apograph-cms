import { useCallback, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import type {
    EntryPublishGuardState,
    EntryPublishOptions,
    EntryPublishVerdict,
    EntrySlotContext
} from '@ortha/content-admin';
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
    },
    checking: {
        id: 'protection.guard.checking',
        defaultMessage:
            'Checking the review state of this version — Publish is held until it comes back.'
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
 * non-publishable type, an unprotected one, a read that has **failed**, and a
 * read in flight with nothing known about the type yet. The failed one matters:
 * a guard that blocked on a failed read would make an unreachable API look like
 * a refused publish, and the person could not tell the two apart. The server
 * refuses the publish regardless, with the reason, so the honest client-side
 * default is silence.
 *
 * The one read in flight it does **not** stay silent about is the beat after a
 * save on a type it already knows is protected. The save mints a new review key
 * (`entryReviewVersion`), so for that beat there is no answer for the version
 * Publish would ship — and silence there is not "no rule", it is "a rule whose
 * numbers we are re-reading". Answering `null` let Publish, the ⋯ menu's _Save &
 * publish_ and an offered bypass all go live with no reason on them; worse, the
 * bypass was gone from `action.onSelect` too, so the click published **without**
 * `bypass: true` and the server answered 403 rather than the dialog opening
 * (`protection:I-18`, and `protection:I-21` for all three doors moving
 * together). So it **holds**, with a reason saying why and no way through —
 * holding the previous answer instead would re-show a satisfied count about a
 * version that no longer exists, and offer a bypass dialog stating numbers the
 * save had already invalidated.
 */
export function usePublishProtectionVerdict(
    context: EntrySlotContext,
    { dirty }: EntryPublishGuardState
): EntryPublishVerdict | null {
    const intl = useIntl();
    const [bypassOpen, setBypassOpen] = useState(false);
    const scope = reviewScopeOf(context);
    const {
        data: review,
        isError: reviewFailed,
        typeKnownProtected
    } = useEntryReview(scope);
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

    /**
     * No answer for the version in hand, on a type a rule is known to cover —
     * the gap a save opens. Held rather than answered, and rather than passed:
     * see this hook's note. A **failed** read is excluded here, because that is
     * the case where the honest answer stays silence.
     *
     * `dirty` does not enter into it: with no answer in hand neither the stored
     * head's numbers nor `afterSave`'s exist, so there is nothing for the dirty
     * branch below to answer from either. Once an answer lands, that branch
     * decides and this is `false`.
     */
    const checking = !!scope && !review && !reviewFailed && typeKnownProtected;

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

    // Before the `outlook` branches: there is no outlook to draw a number from,
    // which is the whole point. No `action`, so every publish path is inert
    // together — the primary button, the menu's Save & publish, and the bypass
    // the administrator would otherwise take without `bypass: true`.
    if (checking) {
        return {
            blocked: true,
            reason: intl.formatMessage(messages.checking)
        };
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
