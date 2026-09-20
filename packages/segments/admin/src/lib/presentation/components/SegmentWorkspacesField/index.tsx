import { defineMessages, useIntl } from 'react-intl';
import { Globe } from 'lucide-react';
import { useWorkspaces } from '@orthacms/workspaces-admin';
import {
    Badge,
    Checkbox,
    Field,
    FieldDescription,
    FieldLabel,
    Skeleton
} from '@orthacms/design-system';

const messages = defineMessages({
    label: {
        id: 'segments.workspaces.label',
        defaultMessage: 'Offered in'
    },
    hint: {
        id: 'segments.workspaces.hint',
        defaultMessage:
            'Which workspaces may choose this audience on their entries. Leave every box clear and it is offered in all of them — including any created later.'
    },
    everywhere: {
        id: 'segments.workspaces.everywhere',
        defaultMessage: 'Every workspace'
    },
    count: {
        id: 'segments.workspaces.count',
        defaultMessage:
            '{count, plural, one {# workspace} other {# workspaces}}'
    },
    narrowing: {
        id: 'segments.workspaces.narrowing',
        defaultMessage:
            'Narrowing this stops the audience being offered on new decisions. Entries that already name it keep it, and keep reading the way they do now.'
    },
    empty: {
        id: 'segments.workspaces.empty',
        defaultMessage:
            'No workspaces exist yet, so this is offered in all of them.'
    },
    error: {
        id: 'segments.workspaces.error',
        defaultMessage:
            'Couldn’t load the workspaces. This audience stays offered wherever it already is.'
    }
});

/**
 * Which workspaces an audience is offered in.
 *
 * **Nothing ticked means every one**, which is the same reading as an entry's
 * empty allow list and the state every audience starts in. It is spelled out on
 * screen rather than left to be inferred, because the opposite reading — an
 * audience nobody has scoped being offered nowhere — is the one that would make
 * the control look broken.
 *
 * Checkboxes rather than a multi-select popover: the list is workspaces, of
 * which an installation has a handful, and the answer is usually "all of them"
 * or "these two". A popover would hide that answer behind a click.
 *
 * A failed workspace read is **not** an empty one. It renders as a warning that
 * leaves the current scope alone, since a form that quietly showed no boxes
 * would invite somebody to save a segment they believe is unscoped.
 */
export function SegmentWorkspacesField({
    value,
    onChange,
    disabled
}: {
    /** The selected workspace ids. Empty means every workspace. */
    value: readonly string[];
    onChange: (next: string[]) => void;
    disabled?: boolean;
}) {
    const intl = useIntl();
    const workspaces = useWorkspaces();
    const selected = new Set(value);

    const toggle = (id: string) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        onChange([...next]);
    };

    return (
        <Field>
            <FieldLabel asChild>
                <span className="flex items-center gap-2">
                    {intl.formatMessage(messages.label)}
                    <Badge variant={selected.size ? 'secondary' : 'outline'}>
                        {selected.size === 0 ? (
                            <Globe className="size-3" aria-hidden />
                        ) : null}
                        {selected.size === 0
                            ? intl.formatMessage(messages.everywhere)
                            : intl.formatMessage(messages.count, {
                                  count: selected.size
                              })}
                    </Badge>
                </span>
            </FieldLabel>

            {workspaces.isPending ? (
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                </div>
            ) : workspaces.isError ? (
                <p role="alert" className="text-sm text-muted-foreground">
                    {intl.formatMessage(messages.error)}
                </p>
            ) : (workspaces.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    {intl.formatMessage(messages.empty)}
                </p>
            ) : (
                <ul className="divide-y overflow-hidden rounded-lg border">
                    {(workspaces.data ?? []).map((workspace) => (
                        <li key={workspace.id}>
                            <label className="flex cursor-pointer items-center gap-3 p-3 text-sm hover:bg-muted/50">
                                <Checkbox
                                    checked={selected.has(workspace.id)}
                                    disabled={disabled}
                                    onCheckedChange={() => toggle(workspace.id)}
                                />
                                <span className="min-w-0">
                                    <span className="font-medium">
                                        {workspace.name}
                                    </span>
                                    <span className="ml-2 text-xs text-muted-foreground">
                                        /{workspace.slug}
                                    </span>
                                </span>
                            </label>
                        </li>
                    ))}
                </ul>
            )}

            <FieldDescription>
                {intl.formatMessage(messages.hint)}
                {selected.size > 0
                    ? ` ${intl.formatMessage(messages.narrowing)}`
                    : ''}
            </FieldDescription>
        </Field>
    );
}
