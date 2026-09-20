import { useMemo, useState } from 'react';
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
    Input,
    Label,
    Spinner,
    cn
} from '@orthacms/design-system';
import { useWorkspaceOptions } from '../../../application/useWorkspaceOptions';
import { MemberAvatar } from '../MemberAvatar';

/** Intl descriptors for {@link AddToWorkspacesDialog}. */
const messages = defineMessages({
    title: {
        id: 'users.addWorkspaces.title',
        defaultMessage: 'Add to workspaces'
    },
    description: {
        id: 'users.addWorkspaces.description',
        defaultMessage: 'Pick the workspaces this member should join.'
    },
    search: {
        id: 'users.addWorkspaces.search',
        defaultMessage: 'Search workspaces'
    },
    none: {
        id: 'users.addWorkspaces.none',
        defaultMessage: 'This member already belongs to every workspace.'
    },
    noMatch: {
        id: 'users.addWorkspaces.noMatch',
        defaultMessage: 'No workspaces match your search.'
    },
    error: {
        id: 'users.addWorkspaces.error',
        defaultMessage: 'Couldn’t load workspaces. Please try again.'
    },
    cancel: { id: 'users.addWorkspaces.cancel', defaultMessage: 'Cancel' },
    add: {
        id: 'users.addWorkspaces.add',
        defaultMessage: 'Add{count, plural, =0 {} other { (#)}}'
    }
});

/**
 * A modal to add the member to one or more workspaces. Lists every workspace
 * they're not already in (via the shared `GET /api/workspaces`), with a search
 * filter and multi-select. The parent runs the actual additions and owns
 * `busy`; the dialog stays open and non-dismissable until they settle.
 */
export function AddToWorkspacesDialog({
    open,
    onOpenChange,
    existingIds,
    busy = false,
    onAdd
}: {
    /** Whether the dialog is shown. */
    open: boolean;
    /** Open/close handler; ignored while busy. */
    onOpenChange: (open: boolean) => void;
    /** Workspace ids the member already belongs to (excluded from the list). */
    existingIds: ReadonlyArray<string>;
    /** Whether additions are in flight. */
    busy?: boolean;
    /** Called with the chosen workspace ids. */
    onAdd: (workspaceIds: string[]) => void;
}) {
    const intl = useIntl();
    const { data, isPending, isError } = useWorkspaceOptions(open);
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const existing = useMemo(() => new Set(existingIds), [existingIds]);
    const available = useMemo(
        () => (data ?? []).filter((workspace) => !existing.has(workspace.id)),
        [data, existing]
    );
    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) {
            return available;
        }
        return available.filter((workspace) =>
            workspace.name.toLowerCase().includes(needle)
        );
    }, [available, query]);

    const toggle = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const close = (next: boolean) => {
        if (busy) {
            return;
        }
        if (!next) {
            setQuery('');
            setSelected(new Set());
        }
        onOpenChange(next);
    };

    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {intl.formatMessage(messages.title)}
                    </DialogTitle>
                    <DialogDescription>
                        {intl.formatMessage(messages.description)}
                    </DialogDescription>
                </DialogHeader>

                {isPending ? (
                    <div className="flex justify-center py-8">
                        <Spinner />
                    </div>
                ) : isError ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                        {intl.formatMessage(messages.error)}
                    </p>
                ) : available.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                        {intl.formatMessage(messages.none)}
                    </p>
                ) : (
                    <div className="space-y-3">
                        <Input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={intl.formatMessage(messages.search)}
                            aria-label={intl.formatMessage(messages.search)}
                            disabled={busy}
                        />
                        {filtered.length === 0 ? (
                            <p className="py-6 text-center text-sm text-muted-foreground">
                                {intl.formatMessage(messages.noMatch)}
                            </p>
                        ) : (
                            <ul className="max-h-64 space-y-1 overflow-y-auto">
                                {filtered.map((workspace) => {
                                    const id = `add-workspace-${workspace.id}`;
                                    const checked = selected.has(workspace.id);
                                    return (
                                        <li key={workspace.id}>
                                            <Label
                                                htmlFor={id}
                                                className={cn(
                                                    'flex cursor-pointer items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted/50',
                                                    busy &&
                                                        'cursor-not-allowed opacity-70'
                                                )}
                                            >
                                                <Checkbox
                                                    id={id}
                                                    checked={checked}
                                                    disabled={busy}
                                                    onCheckedChange={() =>
                                                        toggle(workspace.id)
                                                    }
                                                />
                                                <MemberAvatar
                                                    initials={
                                                        workspace.initials
                                                    }
                                                    color={workspace.color}
                                                    className="size-9 shrink-0 text-xs"
                                                />
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-sm">
                                                        {workspace.name}
                                                    </span>
                                                    {workspace.description ? (
                                                        <span className="line-clamp-3 text-xs text-muted-foreground">
                                                            {
                                                                workspace.description
                                                            }
                                                        </span>
                                                    ) : null}
                                                </span>
                                            </Label>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                )}

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => close(false)}
                        disabled={busy}
                    >
                        {intl.formatMessage(messages.cancel)}
                    </Button>
                    <Button
                        onClick={() => onAdd([...selected])}
                        disabled={busy || selected.size === 0}
                    >
                        {busy ? <Spinner /> : null}
                        {intl.formatMessage(messages.add, {
                            count: selected.size
                        })}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
