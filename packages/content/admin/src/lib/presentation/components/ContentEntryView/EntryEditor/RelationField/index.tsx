import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Plus } from 'lucide-react';
import {
    Avatar,
    AvatarFallback,
    Button,
    Field,
    FieldDescription,
    FieldError,
    FieldLabel
} from '@orthacms/design-system';
import { initialsOf } from '@orthacms/utils-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import type {
    ContentField,
    RelationRef
} from '../../../../../domain/types/contentType';
import { useContentSchema } from '../../../../../application/useContentSchema';
import { useContentEntry } from '../../../../../application/useContentEntry';
import type { RelationCandidate } from '../../../../../application/useRelationCandidates';
import { fieldLabel } from '../../../../../domain/entryColumns';
import { relationLabel } from '../../../../../domain/relationLabel';
import { adminProps } from '../../../../../domain/adminProps';
import { toRelationIds } from '../../../../../domain/relationIds';
import { contentEntryPath } from '../../../../../domain/contentEntryPath';
import {
    handleFor,
    slugFromValues
} from '../../../../../domain/relationHandle';
import { useEntryReadOnly } from '../../../../hooks/useEntryReadOnly';
import { RelationItemRow } from './RelationItemRow';
import { RelationPickerDialog } from './RelationPickerDialog';

const messages = defineMessages({
    assign: {
        id: 'content.relations.field.assign',
        defaultMessage: 'Select {label}'
    },
    empty: {
        id: 'content.relations.field.empty',
        defaultMessage: 'Nothing linked yet.'
    },
    remove: {
        id: 'content.relations.field.remove',
        defaultMessage: 'Remove {title}'
    },
    open: {
        id: 'content.relations.field.open',
        defaultMessage: 'Open {title} in a new tab'
    }
});

/**
 * The editor for one **single** relation field (the form-backed path — a single
 * relation stores one id string in the entry values). Shows the assigned record
 * as an avatar + title + `/handle` + status row with a **Replace** action and a
 * remove control; empty, it shows "Nothing linked yet." and a Select trigger.
 * The {@link RelationPickerDialog} handles search, query-builder filtering, and
 * the single-pick. Fully controlled: the parent owns the id value.
 */
export function RelationField({
    field,
    value,
    error,
    onChange,
    onBlur,
    hideLabel = false,
    initialRefs = []
}: {
    field: ContentField;
    value: unknown;
    error?: string;
    onChange: (value: unknown) => void;
    onBlur?: () => void;
    /** Suppress the built-in label (e.g. when a collapsible header carries it). */
    hideLabel?: boolean;
    /** Server-resolved links assigned when the entry loaded, for titling. */
    initialRefs?: readonly RelationRef[];
}) {
    const intl = useIntl();
    const workspace = useCurrentWorkspace();
    const readOnly = useEntryReadOnly();
    const [open, setOpen] = useState(false);
    // Records picked this session — the id in `value` is all the form keeps, so
    // we remember each chosen candidate to render its row (title/slug/status).
    const [picked, setPicked] = useState<Map<string, RelationCandidate>>(
        new Map()
    );

    const targetName = field.relation?.to ?? '';
    const label = fieldLabel(field);
    const description = adminProps(field).description;

    // The target type's label + fields title the picker and derive slugs.
    const { data: targetSchema } = useContentSchema(targetName, !!targetName);
    const targetLabel = targetSchema?.label ?? targetName;
    const targetFields = targetSchema?.fields ?? [];

    // The single assigned id, if any.
    const ids = toRelationIds(value, false);
    const id = ids[0];

    const refsById = new Map(initialRefs.map((ref) => [ref.id, ref]));

    // A **seeded** id with nothing to title it: the form can hold an FK that
    // never came from a load or a pick — a create form prefilled from another
    // record (the i18n "create a translation" flow copies non-localized
    // relations) has no `initialRefs`, because the aggregate relations read is
    // keyed on a saved entry and there isn't one yet. Without this the row
    // rendered the raw UUID as its own title. Resolve that one record directly;
    // the query is disabled whenever the id is already titled, so the normal
    // load/pick paths cost nothing.
    const unresolvedId =
        id && !picked.has(id) && !refsById.has(id) ? id : undefined;
    const { data: resolved } = useContentEntry(targetName, unresolvedId, {
        enabled: !!targetName && !!unresolvedId
    });

    // Display detail for a linked id: the freshly-picked candidate wins (its slug
    // derived from the target schema), else the server-resolved ref from load,
    // else a record resolved on demand, else the raw id as a last resort.
    const detailFor = (linkedId: string): RelationRef => {
        const candidate = picked.get(linkedId);
        if (candidate) {
            const slug = slugFromValues(candidate.values, targetFields);
            return {
                id: linkedId,
                title: candidate.title,
                ...(slug ? { slug } : {}),
                ...(candidate.status ? { status: candidate.status } : {})
            };
        }
        const ref = refsById.get(linkedId);
        if (ref) return ref;
        if (resolved && resolved.id === linkedId) {
            const slug = slugFromValues(resolved.values, targetFields);
            return {
                id: linkedId,
                title: relationLabel(resolved.values, targetFields, linkedId),
                ...(slug ? { slug } : {}),
                ...(resolved.status ? { status: resolved.status } : {})
            };
        }
        return { id: linkedId, title: linkedId };
    };

    const commit = (next: string | undefined) => {
        onChange(next ?? '');
        onBlur?.();
    };

    // Commit the picker's chosen id, remembering its candidate for display.
    const confirm = (next: string[], chosen: RelationCandidate[]) => {
        if (chosen.length) {
            setPicked((current) => {
                const merged = new Map(current);
                for (const candidate of chosen)
                    merged.set(candidate.id, candidate);
                return merged;
            });
        }
        commit(next[0]);
    };

    const removeLabelFor = (title: string) =>
        intl.formatMessage(messages.remove, { title });
    const openLabelFor = (title: string) =>
        intl.formatMessage(messages.open, { title });
    const hrefFor = (linkedId: string) =>
        targetName
            ? contentEntryPath(workspace.id, targetName, linkedId)
            : undefined;

    const detail = id ? detailFor(id) : null;

    return (
        <Field data-invalid={!!error}>
            {hideLabel ? null : <FieldLabel>{label}</FieldLabel>}

            {detail ? (
                <RelationItemRow
                    title={detail.title}
                    handle={handleFor(detail.title, detail.slug)}
                    status={detail.status}
                    leading={
                        <Avatar className="size-8 shrink-0">
                            <AvatarFallback className="text-xs">
                                {initialsOf(detail.title)}
                            </AvatarFallback>
                        </Avatar>
                    }
                    onRemove={() => commit(undefined)}
                    removeLabel={removeLabelFor(detail.title)}
                    href={hrefFor(detail.id)}
                    openLabel={openLabelFor(detail.title)}
                    onReplace={() => setOpen(true)}
                    readOnly={readOnly}
                />
            ) : (
                <>
                    <p className="text-sm text-muted-foreground">
                        {intl.formatMessage(messages.empty)}
                    </p>
                    {/* An empty relation the reader can't fill: the sentence
                        above is the whole story, so the dashed Select trigger
                        would be an invitation to an action that isn't theirs. */}
                    {readOnly ? null : (
                        <Button
                            type="button"
                            variant="outline"
                            className="w-full justify-center border-dashed shadow-none"
                            onClick={() => setOpen(true)}
                        >
                            <Plus className="size-4" />
                            {intl.formatMessage(messages.assign, {
                                label: targetLabel
                            })}
                        </Button>
                    )}
                </>
            )}

            {/* Inside a RelationFieldSection (hideLabel) the card header already
                carries a description, so the field's own admin description would
                be a redundant second line — suppress it there. */}
            {description && !error && !hideLabel ? (
                <FieldDescription>{description}</FieldDescription>
            ) : null}
            {error ? <FieldError>{error}</FieldError> : null}

            {/* Not mounted at all in preview: nothing can open it, and it would
                otherwise register the target type's candidate queries. */}
            {readOnly ? null : (
                <RelationPickerDialog
                    open={open}
                    onOpenChange={setOpen}
                    targetName={targetName}
                    targetLabel={targetLabel}
                    many={false}
                    selectedIds={ids}
                    onConfirm={confirm}
                />
            )}
        </Field>
    );
}
