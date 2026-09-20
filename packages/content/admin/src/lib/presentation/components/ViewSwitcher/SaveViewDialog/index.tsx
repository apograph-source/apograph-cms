import { useEffect, useId, useState } from 'react';
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
    InputField,
    Label,
    RadioGroup,
    Spinner
} from '@orthacms/design-system';
import {
    VIEW_NAME_MAX_LENGTH,
    VIEW_VISIBILITY,
    type ViewPayload,
    type ViewVisibility
} from '../../../../domain/types/savedView';
import { VisibilityChoice } from './VisibilityChoice';

/** Intl descriptors for {@link SaveViewDialog}, co-located. */
const messages = defineMessages({
    title: { id: 'content.views.save.title', defaultMessage: 'Save view' },
    body: {
        id: 'content.views.save.body',
        defaultMessage: 'This slice is saved for the {label} collection.'
    },
    nameLabel: { id: 'content.views.save.nameLabel', defaultMessage: 'Name' },
    namePlaceholder: {
        id: 'content.views.save.namePlaceholder',
        defaultMessage: 'Needs review'
    },
    visibilityLabel: {
        id: 'content.views.save.visibilityLabel',
        defaultMessage: 'Visibility'
    },
    private: {
        id: 'content.views.save.private',
        defaultMessage: 'Personal'
    },
    privateHint: {
        id: 'content.views.save.privateHint',
        defaultMessage: 'Only you can see it'
    },
    shared: { id: 'content.views.save.shared', defaultMessage: 'Shared' },
    sharedHint: {
        id: 'content.views.save.sharedHint',
        defaultMessage: 'Everyone in this workspace'
    },
    sharedDenied: {
        id: 'content.views.save.sharedDenied',
        defaultMessage: 'Sharing needs the “views:share” permission'
    },
    captured: {
        id: 'content.views.save.captured',
        defaultMessage: 'Saved:'
    },
    notCaptured: {
        id: 'content.views.save.notCaptured',
        defaultMessage:
            'Not saved: the search box, the page number, selected rows'
    },
    capturedFilters: {
        id: 'content.views.save.capturedFilters',
        defaultMessage:
            '{count, plural, =0 {no filters} one {# filter rule} other {# filter rules}}'
    },
    capturedSort: {
        id: 'content.views.save.capturedSort',
        defaultMessage: 'sorted by {column}'
    },
    capturedNoSort: {
        id: 'content.views.save.capturedNoSort',
        defaultMessage: 'no sorting'
    },
    capturedColumns: {
        id: 'content.views.save.capturedColumns',
        defaultMessage: '{count, plural, one {# column} other {# columns}}'
    },
    capturedPageSize: {
        id: 'content.views.save.capturedPageSize',
        defaultMessage: '{count} per page'
    },
    makeDefault: {
        id: 'content.views.save.makeDefault',
        defaultMessage: 'Open this view by default'
    },
    cancel: { id: 'content.views.save.cancel', defaultMessage: 'Cancel' },
    submit: { id: 'content.views.save.submit', defaultMessage: 'Save view' },
    failed: {
        id: 'content.views.save.failed',
        defaultMessage: 'Couldn’t save this view. Please try again.'
    },
    nameTaken: {
        id: 'content.views.save.nameTaken',
        defaultMessage: 'You already have a view with this name.'
    }
});

/** Props for {@link SaveViewDialog}. */
export type SaveViewDialogProps = {
    /** Whether the dialog is on screen. */
    open: boolean;
    /** Opens or closes it. */
    onOpenChange: (open: boolean) => void;
    /** The collection's label, for the dialog's supporting copy. */
    collectionLabel: string;
    /** The slice about to be saved — drives the "what's captured" summary. */
    payload: ViewPayload;
    /** How many filter rules the slice carries. */
    ruleCount: number;
    /** The sorted column's label, or null when unsorted. */
    sortLabel: string | null;
    /** Whether the caller may share a view with the workspace. */
    canShare: boolean;
    /** Whether a submit is in flight. */
    isSaving: boolean;
    /** `409` when the name collides, any other status for the generic error. */
    errorStatus: number | null;
    /** Submits the dialog. */
    onSubmit: (input: {
        name: string;
        visibility: ViewVisibility;
        makeDefault: boolean;
    }) => void;
};

/**
 * The "Save current as view" dialog.
 *
 * Its least obvious element is the **captured summary**. Without it a saved
 * view is a black box, and the first time someone's search doesn't come back
 * they read it as a bug rather than as a deliberate exclusion — so the dialog
 * says both what travels and what doesn't, in the same words the switcher uses.
 */
export function SaveViewDialog({
    open,
    onOpenChange,
    collectionLabel,
    payload,
    ruleCount,
    sortLabel,
    canShare,
    isSaving,
    errorStatus,
    onSubmit
}: SaveViewDialogProps) {
    const intl = useIntl();
    const nameId = useId();
    const [name, setName] = useState('');
    const [visibility, setVisibility] = useState<ViewVisibility>(
        VIEW_VISIBILITY.Private
    );
    const [makeDefault, setMakeDefault] = useState(false);

    // Reset on each open so a cancelled save doesn't pre-fill the next one with
    // a name the user already decided against.
    useEffect(() => {
        if (!open) return;
        setName('');
        setVisibility(VIEW_VISIBILITY.Private);
        setMakeDefault(false);
    }, [open]);

    const trimmed = name.trim();
    const error =
        errorStatus === 409
            ? intl.formatMessage(messages.nameTaken)
            : errorStatus !== null
              ? intl.formatMessage(messages.failed)
              : null;

    const captured = [
        intl.formatMessage(messages.capturedFilters, { count: ruleCount }),
        sortLabel
            ? intl.formatMessage(messages.capturedSort, { column: sortLabel })
            : intl.formatMessage(messages.capturedNoSort),
        intl.formatMessage(messages.capturedColumns, {
            count: payload.columns?.length ?? 0
        }),
        intl.formatMessage(messages.capturedPageSize, {
            count: payload.pageSize ?? 0
        })
    ].join(' · ');

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!isSaving) onOpenChange(next);
            }}
        >
            <DialogContent
                className="max-w-md"
                onOpenAutoFocus={(event) => {
                    // The field is focused here rather than with React's
                    // `autoFocus`, which only fires at mount and loses to
                    // whatever the thing that opened this dialog does next.
                    // Opened from the switcher's menu, Radix's close-autofocus
                    // ran after that mount and the reader got an open dialog
                    // with nothing focused — every keystroke dropped. This runs
                    // as part of the dialog's own open sequence, so the field is
                    // focused no matter which control opened it.
                    event.preventDefault();
                    document.getElementById(nameId)?.focus();
                }}
            >
                <DialogHeader>
                    <DialogTitle>
                        {intl.formatMessage(messages.title)}
                    </DialogTitle>
                    <DialogDescription>
                        {intl.formatMessage(messages.body, {
                            label: collectionLabel
                        })}
                    </DialogDescription>
                </DialogHeader>

                <form
                    className="flex flex-col gap-4"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (!trimmed || isSaving) return;
                        onSubmit({ name: trimmed, visibility, makeDefault });
                    }}
                >
                    {/* The design-system field, so the label, the error and
                        the control are wired together (`aria-describedby` on
                        focus, not only when the message appears) rather than
                        hand-assembled here. */}
                    <InputField
                        id={nameId}
                        label={intl.formatMessage(messages.nameLabel)}
                        value={name}
                        required
                        maxLength={VIEW_NAME_MAX_LENGTH}
                        error={error ?? undefined}
                        placeholder={intl.formatMessage(
                            messages.namePlaceholder
                        )}
                        onChange={(event) => setName(event.target.value)}
                    />

                    <fieldset className="flex flex-col gap-1.5">
                        <legend className="mb-1.5 text-sm font-medium">
                            {intl.formatMessage(messages.visibilityLabel)}
                        </legend>
                        <RadioGroup
                            value={visibility}
                            onValueChange={(next) =>
                                setVisibility(next as ViewVisibility)
                            }
                            className="flex flex-col gap-2 sm:flex-row"
                        >
                            <VisibilityChoice
                                value={VIEW_VISIBILITY.Private}
                                label={intl.formatMessage(messages.private)}
                                hint={intl.formatMessage(messages.privateHint)}
                            />
                            <VisibilityChoice
                                value={VIEW_VISIBILITY.Workspace}
                                label={intl.formatMessage(messages.shared)}
                                hint={
                                    canShare
                                        ? intl.formatMessage(
                                              messages.sharedHint
                                          )
                                        : intl.formatMessage(
                                              messages.sharedDenied
                                          )
                                }
                                disabled={!canShare}
                            />
                        </RadioGroup>
                    </fieldset>

                    <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                        <p>
                            <span className="font-medium text-foreground">
                                {intl.formatMessage(messages.captured)}
                            </span>{' '}
                            {captured}
                        </p>
                        <p className="mt-1">
                            {intl.formatMessage(messages.notCaptured)}
                        </p>
                    </div>

                    <Label className="flex items-center gap-2 text-sm font-normal">
                        <Checkbox
                            checked={makeDefault}
                            onCheckedChange={(next) =>
                                setMakeDefault(next === true)
                            }
                        />
                        {intl.formatMessage(messages.makeDefault)}
                    </Label>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={isSaving}
                        >
                            {intl.formatMessage(messages.cancel)}
                        </Button>
                        <Button type="submit" disabled={!trimmed || isSaving}>
                            {isSaving ? <Spinner aria-hidden /> : null}
                            {intl.formatMessage(messages.submit)}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
