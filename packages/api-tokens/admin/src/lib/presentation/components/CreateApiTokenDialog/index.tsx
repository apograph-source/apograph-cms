import { useEffect, useId, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Alert,
    AlertDescription,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    MultiSelect,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Spinner
} from '@orthacms/design-system';
import type { ApiTokenScope } from '../../../domain/types/apiToken';
import type { CreateApiTokenInput } from '../../../infrastructure/apiTokenGateway';
import { useWorkspaceOptions } from '../../../application/useWorkspaceOptions';

const messages = defineMessages({
    title: {
        id: 'apiTokens.create.title',
        defaultMessage: 'New API token'
    },
    description: {
        id: 'apiTokens.create.description',
        defaultMessage:
            'The token grants API access to the content of every workspace you pick.'
    },
    nameLabel: { id: 'apiTokens.create.name', defaultMessage: 'Name' },
    namePlaceholder: {
        id: 'apiTokens.create.namePlaceholder',
        defaultMessage: 'e.g. Production website'
    },
    workspaceLabel: {
        id: 'apiTokens.create.workspace',
        defaultMessage: 'Workspaces'
    },
    workspacePlaceholder: {
        id: 'apiTokens.create.workspacePlaceholder',
        defaultMessage: 'Select workspaces'
    },
    workspaceSearch: {
        id: 'apiTokens.create.workspaceSearch',
        defaultMessage: 'Search workspaces…'
    },
    workspaceEmpty: {
        id: 'apiTokens.create.workspaceEmpty',
        defaultMessage: 'No workspaces found.'
    },
    workspaceError: {
        id: 'apiTokens.create.workspaceError',
        defaultMessage:
            'Couldn’t load the workspaces. Without them a token can’t be scoped, so try again before creating one.'
    },
    workspaceRetry: {
        id: 'apiTokens.create.workspaceRetry',
        defaultMessage: 'Retry'
    },
    workspaceHint: {
        id: 'apiTokens.create.workspaceHint',
        defaultMessage:
            'Pick one or more. A request names the workspace it targets with the X-Workspace-Id header.'
    },
    scopeLabel: { id: 'apiTokens.create.scope', defaultMessage: 'Access' },
    scopeRead: {
        id: 'apiTokens.create.scopeRead',
        defaultMessage: 'Read-only'
    },
    scopeFull: {
        id: 'apiTokens.create.scopeFull',
        defaultMessage: 'Full access'
    },
    expiryLabel: { id: 'apiTokens.create.expiry', defaultMessage: 'Expires' },
    expiryNever: {
        id: 'apiTokens.create.expiryNever',
        defaultMessage: 'Never'
    },
    expiry30: { id: 'apiTokens.create.expiry30', defaultMessage: '30 days' },
    expiry90: { id: 'apiTokens.create.expiry90', defaultMessage: '90 days' },
    expiry365: {
        id: 'apiTokens.create.expiry365',
        defaultMessage: '1 year'
    },
    cancel: { id: 'apiTokens.create.cancel', defaultMessage: 'Cancel' },
    submit: { id: 'apiTokens.create.submit', defaultMessage: 'Create token' }
});

/** Expiry presets (in days); `never` maps to no expiry. */
type ExpiryPreset = 'never' | '30' | '90' | '365';

/** Turns an expiry preset into an ISO timestamp, or `undefined` for never. */
function expiryToIso(preset: ExpiryPreset): string | undefined {
    if (preset === 'never') {
        return undefined;
    }
    const days = Number(preset);
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * The create-token form. The parent owns `open` and the mutation; on submit it
 * receives a ready-to-send {@link CreateApiTokenInput} (expiry already resolved
 * to an ISO string). The workspace selector is fed by `GET /api/workspaces`, so
 * the page itself needs no workspace context.
 */
export function CreateApiTokenDialog({
    open,
    onOpenChange,
    onSubmit,
    submitting
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (input: CreateApiTokenInput) => void;
    submitting: boolean;
}) {
    const intl = useIntl();
    const nameId = useId();
    const workspacesId = useId();
    const workspacesHintId = useId();
    // The two `Select`s are Radix triggers, not native controls, so a `<Label>`
    // with no `htmlFor` would label nothing and both would announce as a bare
    // combo box carrying only their current value ("Read-only", "Never") — with
    // no way to tell the access control from the expiry one. Wire them the same
    // way the Name field is wired.
    const scopeId = useId();
    const expiryId = useId();
    // The dialog's element. Radix Dialog scroll-locks the page while open, so
    // the workspace multi-select's popover must portal INTO it or its list
    // won't scroll by mouse wheel — the same reason the relation picker and the
    // records filter drawer capture theirs.
    const [dialogEl, setDialogEl] = useState<HTMLDivElement | null>(null);
    const {
        data: workspaces = [],
        isError: workspacesFailed,
        refetch: refetchWorkspaces
    } = useWorkspaceOptions(open);

    const [name, setName] = useState('');
    const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
    const [scope, setScope] = useState<ApiTokenScope>('read');
    const [expiry, setExpiry] = useState<ExpiryPreset>('never');

    const reset = () => {
        setName('');
        setWorkspaceIds([]);
        setScope('read');
        setExpiry('never');
    };

    // The server rejects an empty bucket (400), so the form does too.
    const canSubmit = name.trim().length > 0 && workspaceIds.length > 0;

    const submit = () => {
        if (!canSubmit) {
            return;
        }
        onSubmit({
            name: name.trim(),
            workspaceIds,
            scope,
            expiresAt: expiryToIso(expiry)
        });
    };

    // Reset on the way *in*, not only on the way out. Closing happens four
    // ways and one of them — a successful mint — flips the controlled `open`
    // prop from the page, which never reaches Radix's `onOpenChange`. Keying
    // off the opening edge is the one place that catches every path, so the
    // dialog cannot present a previous draft as a fresh form.
    const wasOpen = useRef(open);
    useEffect(() => {
        if (open && !wasOpen.current) {
            reset();
        }
        wasOpen.current = open;
    });

    /** The one way out of this dialog, so every path resets the form. */
    const requestClose = () => {
        reset();
        onOpenChange(false);
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    reset();
                }
                onOpenChange(next);
            }}
        >
            <DialogContent ref={setDialogEl}>
                <DialogHeader>
                    <DialogTitle>
                        {intl.formatMessage(messages.title)}
                    </DialogTitle>
                    <DialogDescription>
                        {intl.formatMessage(messages.description)}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor={nameId}>
                            {intl.formatMessage(messages.nameLabel)}
                        </Label>
                        <Input
                            id={nameId}
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            placeholder={intl.formatMessage(
                                messages.namePlaceholder
                            )}
                            autoFocus
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor={workspacesId}>
                            {intl.formatMessage(messages.workspaceLabel)}
                        </Label>
                        <MultiSelect
                            id={workspacesId}
                            options={workspaces.map((workspace) => ({
                                value: workspace.id,
                                label: workspace.name
                            }))}
                            value={workspaceIds}
                            onChange={setWorkspaceIds}
                            placeholder={intl.formatMessage(
                                messages.workspacePlaceholder
                            )}
                            searchPlaceholder={intl.formatMessage(
                                messages.workspaceSearch
                            )}
                            emptyText={intl.formatMessage(
                                messages.workspaceEmpty
                            )}
                            aria-describedby={workspacesHintId}
                            container={dialogEl}
                            className="w-full"
                        />
                        <p
                            id={workspacesHintId}
                            className="text-xs text-muted-foreground"
                        >
                            {intl.formatMessage(messages.workspaceHint)}
                        </p>
                        {/* A failed workspace fetch leaves the selector empty,
                            which reads exactly like a deployment with no
                            workspaces — so the admin would think there is
                            nothing to pick rather than that the list failed.
                            Say which it is, and offer the retry. */}
                        {workspacesFailed ? (
                            <Alert variant="destructive" role="alert">
                                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                                    <span>
                                        {intl.formatMessage(
                                            messages.workspaceError
                                        )}
                                    </span>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="shadow-none"
                                        onClick={() => refetchWorkspaces()}
                                    >
                                        {intl.formatMessage(
                                            messages.workspaceRetry
                                        )}
                                    </Button>
                                </AlertDescription>
                            </Alert>
                        ) : null}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor={scopeId}>
                            {intl.formatMessage(messages.scopeLabel)}
                        </Label>
                        <Select
                            value={scope}
                            onValueChange={(value) =>
                                setScope(value as ApiTokenScope)
                            }
                        >
                            <SelectTrigger id={scopeId} className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="read">
                                    {intl.formatMessage(messages.scopeRead)}
                                </SelectItem>
                                <SelectItem value="full">
                                    {intl.formatMessage(messages.scopeFull)}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor={expiryId}>
                            {intl.formatMessage(messages.expiryLabel)}
                        </Label>
                        <Select
                            value={expiry}
                            onValueChange={(value) =>
                                setExpiry(value as ExpiryPreset)
                            }
                        >
                            <SelectTrigger id={expiryId} className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="never">
                                    {intl.formatMessage(messages.expiryNever)}
                                </SelectItem>
                                <SelectItem value="30">
                                    {intl.formatMessage(messages.expiry30)}
                                </SelectItem>
                                <SelectItem value="90">
                                    {intl.formatMessage(messages.expiry90)}
                                </SelectItem>
                                <SelectItem value="365">
                                    {intl.formatMessage(messages.expiry365)}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        // `requestClose`, not `onOpenChange` directly: the reset
                        // lives in the Dialog's own handler, which Esc, the
                        // backdrop and the corner X all go through — and this
                        // button did not, so Cancel left the name, workspaces,
                        // scope and expiry in place for the next open. An admin
                        // who cancelled "Production website" and reopened was
                        // one click from minting a second live credential under
                        // the same name.
                        onClick={requestClose}
                        disabled={submitting}
                    >
                        {intl.formatMessage(messages.cancel)}
                    </Button>
                    <Button
                        onClick={submit}
                        disabled={!canSubmit || submitting}
                    >
                        {submitting ? <Spinner /> : null}
                        {intl.formatMessage(messages.submit)}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
