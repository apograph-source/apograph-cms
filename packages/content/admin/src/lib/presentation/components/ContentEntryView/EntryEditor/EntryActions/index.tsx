import { useId } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Save, Send } from 'lucide-react';
import {
    Button,
    Spinner,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    cn
} from '@orthacms/design-system';
import { useHasPermission } from '@orthacms/identity-admin';
import type { EntryRecord } from '../../../../../domain/types/contentType';
import {
    CONTENT_CREATE,
    CONTENT_DELETE,
    CONTENT_PUBLISH,
    CONTENT_UPDATE,
    ENTRY_STATUS
} from '../../../../../domain/constants';
import { useEntrySlotContext } from '../../../../hooks/useEntrySlotContext';
import {
    ENTRY_PUBLISH_GUARD_SLOT,
    type EntryPublishGuardState,
    type EntryPublishOptions,
    type EntryPublishVerdict,
    type EntrySlotContext
} from '../../../../slots/contentSlots';
import { EntryMenu } from './EntryMenu';

const messages = defineMessages({
    save: { id: 'content.editor.save', defaultMessage: 'Save' },
    saveDraft: { id: 'content.editor.saveDraft', defaultMessage: 'Save draft' },
    publish: { id: 'content.editor.publish', defaultMessage: 'Publish' }
});

/** Icon + label per primary kind. */
const PRIMARY_META = {
    publish: { icon: Send, label: messages.publish },
    save: { icon: Save, label: messages.save },
    saveDraft: { icon: Save, label: messages.saveDraft }
} as const;

/**
 * The guard slot's answer for this entry: the first refusal, plus every
 * contributed overlay.
 *
 * Every item's hook is called, in slot order, on every render — the same
 * rules-of-hooks contract the other hook-style items here follow. Only the
 * **first** blocking verdict is read, mirroring the server port's "first
 * refusal wins and no later guard is asked"; the difference is that here the
 * later guards are still asked, because not calling a hook is not an option.
 *
 * Overlays are collected from **every** item, blocked or not: a contribution
 * that has just published through its own action still has a dialog on screen
 * for the moment its verdict flips.
 */
function usePublishVerdict(
    context: EntrySlotContext | null,
    state: EntryPublishGuardState
) {
    const items = ENTRY_PUBLISH_GUARD_SLOT.getItems();
    const verdicts: (EntryPublishVerdict | null)[] = [];
    for (const item of items) {
        // A hook in a loop, which is safe here for the reason every hook-style
        // item in this module relies on: slot items are boot-frozen, so the
        // list never changes length between renders. The call is
        // unconditional — a contribution with nothing to say returns `null`
        // rather than being skipped.
        verdicts.push(context ? item.useVerdict(context, state) : null);
    }

    const blocking = verdicts.find((verdict) => verdict?.blocked) ?? null;
    const overlays = items
        .map((item, index) => ({ id: item.id, node: verdicts[index]?.overlay }))
        .filter((entry) => !!entry.node);

    return { blocking, overlays };
}

/**
 * The entry editor's **write actions**, rendered into the page top bar's actions
 * region (`PageActionsPortal`): a primary button — **Publish** for a publishable
 * type the user may publish, else **Save** / **Save draft** — beside the
 * {@link EntryMenu} holding the rest.
 *
 * They live in the bar rather than in the Properties panel because the panel can
 * be collapsed away entirely, and a record you can't save is a trap. Rendered
 * through a portal from inside the editor, so the handlers, the busy state and
 * `useHasPermission` all resolve against the editor's own tree.
 *
 * Owns the permission gating and the primary/menu derivation; the menu owns its
 * own contents (including the delete confirmation and any contributed overlay).
 *
 * It also owns the **third** gate on that button. `content:publish` decides
 * whether it renders at all and the publish gate decides whether the values are
 * complete; a contribution to {@link ENTRY_PUBLISH_GUARD_SLOT} may then refuse
 * the publish for a reason this package never learns. With nothing contributed
 * the button is exactly what the first two gates made it.
 */
export function EntryActions({
    entry,
    publishable,
    paranoid,
    isCreate,
    saving,
    mutating = false,
    dirty = false,
    onSaveDraft,
    onPublish,
    onUnpublish,
    onDelete
}: {
    entry?: EntryRecord;
    publishable: boolean;
    /** Whether delete is a soft delete (trash) vs a permanent removal. */
    paranoid: boolean;
    isCreate: boolean;
    saving: boolean;
    /** Whether an unpublish/delete action is in flight (disables the bar). */
    mutating?: boolean;
    /** Whether the form holds unsaved changes — handed to the publish guards. */
    dirty?: boolean;
    /** Save without publishing (the default submit). */
    onSaveDraft: () => void;
    /**
     * Save (when anything is unsaved) and mark published — only wired for
     * publishable types. Options come from a guard's action, never from here.
     */
    onPublish: (options?: EntryPublishOptions) => void;
    /** Revert a published entry to draft — only on a saved publishable entry. */
    onUnpublish?: () => void;
    /** Delete the entry — only on a saved entry. */
    onDelete?: () => void;
}) {
    const intl = useIntl();
    // Always present in practice — `ContentEntryView` wraps the editor in the
    // provider. The menu needs it (contributed items are resolved against it),
    // so it renders only alongside a context rather than with a stand-in.
    const slotContext = useEntrySlotContext();
    const reasonId = useId();

    const canCreate = useHasPermission(CONTENT_CREATE);
    const canUpdate = useHasPermission(CONTENT_UPDATE);
    const canPublish = useHasPermission(CONTENT_PUBLISH);
    const canDelete = useHasPermission(CONTENT_DELETE);
    const canSave = isCreate ? canCreate : canUpdate;

    const busy = saving || mutating;
    const published = entry?.status === ENTRY_STATUS.Published;

    const { blocking, overlays } = usePublishVerdict(slotContext, { dirty });

    const showSaveDraft = publishable && canSave;
    const showPublish = publishable && canPublish && canSave;
    const showUnpublish =
        !isCreate && publishable && published && canPublish && !!onUnpublish;
    const showDelete = !isCreate && canDelete && !!onDelete;

    // A guard speaks about publishing, so it says nothing about a Save button.
    // Without this a refusal would silently disable the draft save on a type
    // whose drafts are explicitly still editable.
    const guard = showPublish ? blocking : null;
    const override = guard?.action;

    // Blocked with no way through: the control stays in the tab order and
    // carries its reason as a description, rather than going `disabled`.
    // A `disabled` button is not focusable and holds no tooltip, so the person
    // most likely to need the explanation is the one who cannot reach it —
    // the treatment `GuardedMenuItem` already uses for the same problem.
    const inert = !!guard && !override;

    // Every way to publish from this bar — the primary button and the menu's
    // "Save & publish" — goes through this one handler, so the menu cannot be
    // the door a refusal forgot to close. An override keeps the button an
    // ordinary Publish and hands the click to the contribution, which publishes
    // through `onPublish` once its own ceremony is done.
    const publish = override
        ? () => override.onSelect((options) => onPublish(options))
        : () => onPublish();

    // The primary button: Publish for a publishable type the user may publish,
    // else a plain Save (draft / live). Null when the user can't write at all.
    const primary = showPublish
        ? { kind: 'publish' as const, onClick: publish }
        : canSave
          ? {
                kind: (publishable ? 'saveDraft' : 'save') as
                    | 'saveDraft'
                    | 'save',
                onClick: onSaveDraft
            }
          : null;

    const primaryMeta = primary ? PRIMARY_META[primary.kind] : null;
    const PrimaryIcon = primaryMeta?.icon;
    const label = primaryMeta ? intl.formatMessage(primaryMeta.label) : '';

    const button =
        primary && primaryMeta && PrimaryIcon ? (
            <Button
                type="button"
                size="sm"
                className={cn(inert && 'opacity-60')}
                aria-disabled={inert || undefined}
                aria-describedby={guard?.reason ? reasonId : undefined}
                onClick={
                    inert
                        ? (event) => event.preventDefault()
                        : () => primary.onClick()
                }
                disabled={busy}
            >
                {saving ? <Spinner aria-hidden /> : <PrimaryIcon aria-hidden />}
                {label}
            </Button>
        ) : null;

    return (
        <>
            {button && guard?.reason ? (
                <Tooltip>
                    <TooltipTrigger asChild>{button}</TooltipTrigger>
                    <TooltipContent className="max-w-60">
                        {guard.reason}
                    </TooltipContent>
                </Tooltip>
            ) : (
                button
            )}
            {/* The reason is the button's **description**, so it lives beside
                it rather than inside it: text nested in a control joins its
                accessible *name*, which would have a screen reader announce
                "Publish anyway, 2 approvals required, 0 given" as the thing to
                press. `aria-describedby` resolves by id anywhere in the
                document, so nothing is lost by moving it out. The tooltip is
                the visual half of the same sentence, and is why the control
                keeps `aria-disabled` over `disabled` — Radix needs the pointer
                and focus events a disabled button never fires. */}
            {guard?.reason && (
                <span id={reasonId} className="sr-only">
                    {guard.reason}
                </span>
            )}
            {slotContext && (
                <EntryMenu
                    context={slotContext}
                    paranoid={paranoid}
                    busy={busy}
                    showSaveDraft={showSaveDraft}
                    showPublish={showPublish}
                    publishBlocked={inert}
                    showUnpublish={showUnpublish}
                    showDelete={showDelete}
                    onSaveDraft={onSaveDraft}
                    onPublish={publish}
                    onUnpublish={onUnpublish}
                    onDelete={onDelete}
                />
            )}
            {/* Outside the button, which is relabelled and re-rendered as the
                verdict changes — a dialog mounted inside it would close with
                it. Same rule `ENTRY_MENU_SLOT` overlays follow. */}
            {overlays.map((overlay) => (
                <span key={overlay.id}>{overlay.node}</span>
            ))}
        </>
    );
}
