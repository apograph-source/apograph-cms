import { defineMessages, useIntl } from 'react-intl';
import { AlertCircle } from 'lucide-react';
import { Spinner } from '@orthacms/design-system';
import type {
    ContentField,
    RelationRef,
    StagedRelation
} from '../../../../../domain/types/contentType';
import { useContentSchema } from '../../../../../application/useContentSchema';
import { RelationSyncMark } from './RelationSyncMark';
import { fieldLabel } from '../../../../../domain/entryColumns';
import { ChangedBadge } from '../../../ChangedBadge';
import { RelationField } from '../RelationField';
import { RelationFieldLive } from '../RelationFieldLive';

const messages = defineMessages({
    linked: {
        id: 'content.relations.section.linked',
        defaultMessage:
            '{count, plural, =0 {None} one {# linked} other {# linked}}'
    },
    invalid: {
        id: 'content.relations.section.invalid',
        defaultMessage: 'This relation has an error'
    },
    loadingCount: {
        id: 'content.relations.section.loadingCount',
        defaultMessage: 'Loading linked count…'
    },
    descSingle: {
        id: 'content.relations.section.descSingle',
        defaultMessage: 'Single relation — one record from {target}.'
    },
    descMany: {
        id: 'content.relations.section.descMany',
        defaultMessage:
            'Ordered relation — drag to reorder, or use the arrows. Order is delivered as-is.'
    },
    descInverse: {
        id: 'content.relations.section.descInverse',
        defaultMessage: 'Linked from {target}.'
    }
});

/**
 * One relation field as a **titled card** in the editor's Relations tab: a
 * header (label + a derived description + — for a many relation — a right-aligned
 * "{n} linked" count + a "Changed" badge when edited) over the always-expanded
 * field editor. A **many/inverse** relation is edited by the staged {@link
 * RelationFieldLive} (its links are sent as a delta on Save); a **single**
 * relation uses the form-backed {@link RelationField}. `count` and `changed` are
 * supplied by the parent so the header reflects staged edits without this
 * component owning the data. An error tints the border and shows an alert icon.
 */
export function RelationFieldSection({
    field,
    count,
    changed,
    error,
    typeName,
    entryId,
    value,
    onChange,
    onBlur,
    initialRefs,
    staged,
    onStagedChange
}: {
    field: ContentField;
    /**
     * Linked count shown in the header of a many/inverse relation (server total ±
     * staged), or `null` while the count is still loading — rendered as a neutral
     * affordance so a populated relation never flashes 0. Ignored for single
     * relations (whose assigned/empty state is self-evident on the row).
     */
    count: number | null;
    /** Whether the field has unsaved changes (drives the "Changed" badge). */
    changed: boolean;
    error?: string;
    /** The content type name — for the live relation's paginated read. */
    typeName: string;
    /** The existing entry's id; absent while creating. */
    entryId?: string;
    /** Form value — the single-relation path only. */
    value?: unknown;
    onChange?: (value: unknown) => void;
    onBlur?: () => void;
    /** Server-resolved links for titling — the single-relation path only. */
    initialRefs?: readonly RelationRef[];
    /** Staged link/unlink/reorder — the many/inverse path only. */
    staged?: StagedRelation;
    onStagedChange?: (next: StagedRelation) => void;
}) {
    const intl = useIntl();

    const many = !!field.relation?.many;
    const inverse = !!field.relation?.inverse;
    const live = many || inverse;

    // The target type's label titles the description ("one record from Authors").
    const targetName = field.relation?.to ?? '';
    const { data: targetSchema } = useContentSchema(targetName, !!targetName);
    const targetLabel = targetSchema?.label ?? targetName;

    const description = inverse
        ? intl.formatMessage(messages.descInverse, { target: targetLabel })
        : many
          ? intl.formatMessage(messages.descMany)
          : intl.formatMessage(messages.descSingle, { target: targetLabel });

    return (
        <div
            className={`rounded-2xl border bg-card ${
                error ? 'border-destructive/50' : ''
            }`}
        >
            <div className="flex items-start gap-2 px-4 pt-3.5">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        {/* `<h2>` for the same reason as `FieldGroup`'s: a
                            relation card is a top-level section under the
                            editor's `<h1>`, so `<h3>` skipped a level. */}
                        <h2 className="text-sm font-medium">
                            {fieldLabel(field)}
                        </h2>
                        {/* Read off THIS field's own schema, not the target's
                            i18n flag: what matters to the editor is whether a
                            save here reaches the other locales, and only the
                            server's derived mode answers that (an opted-out
                            relation to a localized target reads `none`). It
                            also saves waiting on the target schema fetch. */}
                        <RelationSyncMark mode={field.relation?.localeSync} />
                        {changed ? <ChangedBadge /> : null}
                        {error ? (
                            <AlertCircle
                                className="size-4 shrink-0 text-destructive"
                                aria-label={intl.formatMessage(
                                    messages.invalid
                                )}
                            />
                        ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                        {description}
                    </p>
                </div>
                {live ? (
                    count === null ? (
                        <Spinner
                            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                            aria-label={intl.formatMessage(
                                messages.loadingCount
                            )}
                        />
                    ) : (
                        <span className="mt-0.5 shrink-0 tabular-nums text-xs text-muted-foreground">
                            {intl.formatMessage(messages.linked, { count })}
                        </span>
                    )
                ) : null}
            </div>
            <div className="px-4 pb-4 pt-3">
                {live ? (
                    <RelationFieldLive
                        field={field}
                        typeName={typeName}
                        entryId={entryId}
                        error={error}
                        staged={
                            staged ?? {
                                added: [],
                                removed: [],
                                order: null
                            }
                        }
                        onStagedChange={onStagedChange ?? (() => undefined)}
                    />
                ) : (
                    <RelationField
                        field={field}
                        value={value}
                        error={error}
                        onChange={onChange ?? (() => undefined)}
                        onBlur={onBlur}
                        hideLabel
                        initialRefs={initialRefs}
                    />
                )}
            </div>
        </div>
    );
}
