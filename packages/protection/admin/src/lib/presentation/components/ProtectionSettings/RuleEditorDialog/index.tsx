import { useEffect, useId, useState, type RefObject } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Button,
    Checkbox,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Field,
    FieldDescription,
    FieldLabel,
    Input,
    Switch,
    toast
} from '@orthacms/design-system';
import {
    DEFAULT_PROTECTION_RULE,
    REQUIRED_APPROVALS_MAX,
    blocksEveryone,
    type ProtectedTypeRow,
    type ProtectionRule
} from '../../../../domain/types';
import {
    useDeleteProtectionRule,
    useSaveProtectionRule
} from '../../../../application/hooks';

const messages = defineMessages({
    title: {
        id: 'protection.settings.editor.title',
        defaultMessage: 'Protection for {label}'
    },
    body: {
        id: 'protection.settings.editor.body',
        defaultMessage:
            'A protected type needs approvals before an entry can be published. Drafts are edited freely — publication is protected, not the record.'
    },
    enabled: {
        id: 'protection.settings.editor.enabled',
        defaultMessage: 'Require review before publishing'
    },
    count: {
        id: 'protection.settings.editor.count',
        defaultMessage: 'Approvals needed'
    },
    countHelp: {
        id: 'protection.settings.editor.countHelp',
        defaultMessage:
            'Counted on the current version only. Saving the entry starts the count again.'
    },
    otherPerson: {
        id: 'protection.settings.editor.otherPerson',
        defaultMessage: 'The author cannot approve their own version'
    },
    otherPersonHelp: {
        id: 'protection.settings.editor.otherPersonHelp',
        defaultMessage:
            'Whoever saved the current version is left out of the count, administrators included.'
    },
    stale: {
        id: 'protection.settings.editor.stale',
        defaultMessage: 'Count approvals from earlier versions'
    },
    staleHelp: {
        id: 'protection.settings.editor.staleHelp',
        defaultMessage:
            'Not recommended. An approval that outlives the edit it approved is the thing this feature exists to prevent.'
    },
    bypass: {
        id: 'protection.settings.editor.bypass',
        defaultMessage: 'An administrator may publish in spite of the rule'
    },
    bypassHelp: {
        id: 'protection.settings.editor.bypassHelp',
        defaultMessage:
            'Every override needs a reason and appears in the activity log. Turning this off makes the rule absolute, administrators included.'
    },
    token: {
        id: 'protection.settings.editor.token',
        defaultMessage: 'An API token may publish this type'
    },
    tokenHelp: {
        id: 'protection.settings.editor.tokenHelp',
        defaultMessage:
            'A token still needs the approvals — this only stops it being refused outright. It is off by default because a token names nobody in the log.'
    },
    aloneTitle: {
        id: 'protection.settings.editor.aloneTitle',
        defaultMessage: 'Nobody could publish this type'
    },
    aloneBody: {
        id: 'protection.settings.editor.aloneBody',
        defaultMessage:
            'This workspace has one member, and the author cannot approve their own version — so no entry of this type could be published except by an administrator overriding the rule.'
    },
    readOnly: {
        id: 'protection.settings.editor.readOnly',
        defaultMessage: 'You can view this rule but not change it.'
    },
    cancel: {
        id: 'protection.settings.editor.cancel',
        defaultMessage: 'Cancel'
    },
    save: { id: 'protection.settings.editor.save', defaultMessage: 'Save' },
    saving: {
        id: 'protection.settings.editor.saving',
        defaultMessage: 'Saving…'
    },
    remove: {
        id: 'protection.settings.editor.remove',
        defaultMessage: 'Remove rule'
    },
    saved: {
        id: 'protection.settings.editor.saved',
        defaultMessage: 'Protection updated for {label}.'
    },
    removed: {
        id: 'protection.settings.editor.removed',
        defaultMessage: 'Protection removed from {label}.'
    },
    failed: {
        id: 'protection.settings.editor.failed',
        defaultMessage: 'That change could not be saved.'
    }
});

/** The four boolean options, so the list is declared once. */
type OptionKey =
    | 'requireOtherPerson'
    | 'countStaleApprovals'
    | 'adminBypass'
    | 'allowTokenPublish';

/**
 * The rule editor for one content type.
 *
 * **It edits all six fields and submits all six**, because `PUT` replaces
 * rather than patches: a form that sent only what it showed would silently
 * reset the rest to their defaults, and "what does this rule do" would become a
 * question about the order somebody edited it in.
 *
 * It restores focus itself. The dialog is mounted only while a row is being
 * edited, so closing it unmounts the whole subtree in the same commit — and
 * Radix's own restore, which runs against the node it captured on mount, never
 * gets the chance. The trigger is captured at the moment of the click instead.
 *
 * The one-member warning is a **live region**, not a paragraph. Somebody who
 * has just flipped a toggle is looking at the toggle; a warning that only
 * appears below it is a warning they meet a week later, when a publish fails
 * for a reason nothing on the screen explains. ADR-0017 accepts that a
 * one-person workspace blocks itself and says the interface must name it at the
 * moment the rule is switched on — this is that moment.
 */
export function RuleEditorDialog({
    open,
    onOpenChange,
    row,
    workspaceId,
    memberCount,
    canManage,
    returnFocusTo
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The type being edited, with the rule it already holds. */
    row: ProtectedTypeRow;
    /** The open workspace — the rules cache is keyed by it. */
    workspaceId: string;
    /** How many people belong to the workspace, for the four-eyes warning. */
    memberCount: number;
    /** Whether this person holds `protection:manage`. */
    canManage: boolean;
    /** The control that opened this, so closing puts focus back on it. */
    returnFocusTo?: RefObject<HTMLElement | null>;
}) {
    const intl = useIntl();
    const countId = useId();
    const save = useSaveProtectionRule(workspaceId);
    const remove = useDeleteProtectionRule(workspaceId);

    const stored: ProtectionRule = row.rule ?? DEFAULT_PROTECTION_RULE;
    const [draft, setDraft] = useState<ProtectionRule>(stored);

    // Re-baseline when the dialog opens: a rule another administrator changed
    // while this was closed must not be overwritten by a stale form.
    useEffect(() => {
        if (open) setDraft(row.rule ?? DEFAULT_PROTECTION_RULE);
    }, [open, row.rule]);

    const set = <K extends keyof ProtectionRule>(
        key: K,
        value: ProtectionRule[K]
    ) => setDraft((current) => ({ ...current, [key]: value }));

    const alone = blocksEveryone(draft, memberCount);
    const busy = save.isPending || remove.isPending;

    const options: { key: OptionKey; label: string; help: string }[] = [
        {
            key: 'requireOtherPerson',
            label: intl.formatMessage(messages.otherPerson),
            help: intl.formatMessage(messages.otherPersonHelp)
        },
        {
            key: 'countStaleApprovals',
            label: intl.formatMessage(messages.stale),
            help: intl.formatMessage(messages.staleHelp)
        },
        {
            key: 'adminBypass',
            label: intl.formatMessage(messages.bypass),
            help: intl.formatMessage(messages.bypassHelp)
        },
        {
            key: 'allowTokenPublish',
            label: intl.formatMessage(messages.token),
            help: intl.formatMessage(messages.tokenHelp)
        }
    ];

    const submit = () =>
        save.mutate(
            { kind: row.kind, slug: row.slug, rule: draft },
            {
                onSuccess: () => {
                    toast.success(
                        intl.formatMessage(messages.saved, { label: row.label })
                    );
                    onOpenChange(false);
                },
                onError: () => toast.error(intl.formatMessage(messages.failed))
            }
        );

    const drop = () =>
        remove.mutate(
            { kind: row.kind, slug: row.slug },
            {
                onSuccess: () => {
                    toast.success(
                        intl.formatMessage(messages.removed, {
                            label: row.label
                        })
                    );
                    onOpenChange(false);
                },
                onError: () => toast.error(intl.formatMessage(messages.failed))
            }
        );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-w-lg"
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
                        {intl.formatMessage(messages.title, {
                            label: row.label
                        })}
                    </DialogTitle>
                    <DialogDescription>
                        {intl.formatMessage(messages.body)}
                    </DialogDescription>
                </DialogHeader>

                {/* Said in text, not implied by greyed-out controls. */}
                {!canManage ? (
                    <p className="text-sm text-muted-foreground">
                        {intl.formatMessage(messages.readOnly)}
                    </p>
                ) : null}

                <div className="flex flex-col gap-4">
                    <Field orientation="horizontal">
                        <span className="text-sm font-medium">
                            {intl.formatMessage(messages.enabled)}
                        </span>
                        <Switch
                            checked={draft.enabled}
                            disabled={!canManage}
                            aria-label={intl.formatMessage(messages.enabled)}
                            onCheckedChange={(next) => set('enabled', next)}
                        />
                    </Field>

                    <Field>
                        <FieldLabel htmlFor={countId}>
                            {intl.formatMessage(messages.count)}
                        </FieldLabel>
                        {/* A real number input: the mockup's −/+ pair around a
                            span is not operable by keyboard and carries no
                            value a screen reader can read back. */}
                        <Input
                            id={countId}
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={REQUIRED_APPROVALS_MAX}
                            className="w-24"
                            disabled={!canManage}
                            value={draft.requiredApprovals}
                            onChange={(event) =>
                                set(
                                    'requiredApprovals',
                                    clamp(Number(event.target.value))
                                )
                            }
                        />
                        <FieldDescription>
                            {intl.formatMessage(messages.countHelp)}
                        </FieldDescription>
                    </Field>

                    {options.map(({ key, label, help }) => (
                        <Field key={key} orientation="horizontal">
                            <Checkbox
                                id={`${countId}-${key}`}
                                checked={draft[key]}
                                disabled={!canManage}
                                onCheckedChange={(next) =>
                                    set(key, next === true)
                                }
                            />
                            <div className="min-w-0">
                                <FieldLabel htmlFor={`${countId}-${key}`}>
                                    {label}
                                </FieldLabel>
                                <FieldDescription>{help}</FieldDescription>
                            </div>
                        </Field>
                    ))}
                </div>

                {/* Announced, not merely rendered — see the component's note. */}
                <div role="status" aria-live="polite">
                    {alone ? (
                        <div className="rounded-md border border-warning bg-warning-soft p-3 text-sm text-warning-soft-foreground">
                            <p className="font-medium">
                                {intl.formatMessage(messages.aloneTitle)}
                            </p>
                            <p className="mt-1">
                                {intl.formatMessage(messages.aloneBody)}
                            </p>
                        </div>
                    ) : null}
                </div>

                <DialogFooter className="sm:justify-between">
                    <div>
                        {canManage && row.rule ? (
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={drop}
                                disabled={busy}
                            >
                                {intl.formatMessage(messages.remove)}
                            </Button>
                        ) : null}
                    </div>
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={busy}
                        >
                            {intl.formatMessage(messages.cancel)}
                        </Button>
                        {canManage ? (
                            <Button
                                type="button"
                                onClick={submit}
                                disabled={busy}
                            >
                                {intl.formatMessage(
                                    busy ? messages.saving : messages.save
                                )}
                            </Button>
                        ) : null}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/** Clamps a typed count into the range the API stores. */
function clamp(value: number): number {
    if (!Number.isFinite(value)) return 1;
    return Math.min(REQUIRED_APPROVALS_MAX, Math.max(1, Math.trunc(value)));
}
