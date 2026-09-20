import { defineMessages, useIntl } from 'react-intl';
import { AlertCircle, Globe } from 'lucide-react';
import {
    cn,
    Field,
    FieldDescription,
    FieldError,
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from '@orthacms/design-system';
import {
    ChangedBadge,
    type ContentField,
    type MediaRef
} from '@orthacms/content-admin';
import { MediaFieldControl } from '../../MediaFieldControl';
import type { MediaPendingUploads } from '../../../types/pendingUpload';
import type { MediaAccept } from '../../../utils/mediaAccept';

/** Intl descriptors for {@link MediaFieldSection}, co-located. */
const messages = defineMessages({
    invalid: {
        id: 'media.section.invalid',
        defaultMessage: 'This field has an error'
    },
    localized: {
        id: 'media.section.localized',
        defaultMessage: 'This asset can differ per locale.'
    },
    localizedLabel: {
        id: 'media.section.localizedLabel',
        defaultMessage: 'Localized field'
    },
    descSingle: {
        id: 'media.section.descSingle',
        defaultMessage: 'One asset from the Media Library.'
    },
    descMultiple: {
        id: 'media.section.descMultiple',
        defaultMessage:
            'Ordered list — assets are delivered in the order shown here.'
    }
});

/** The display label for a field — its admin label, else its machine name. */
function labelOf(field: ContentField): string {
    const label = field.admin?.['label'];
    return typeof label === 'string' && label ? label : field.name;
}

/**
 * One media field as a **titled card** in the entry editor's Media tab —
 * deliberately the same shape as the Relations tab's `RelationFieldSection`, so
 * the two contributed tabs read as one editor: a header (label, required mark,
 * the localized globe, a "Changed" pill, an error alert) over a one-line
 * description of what the field holds, then the {@link MediaFieldControl}. An
 * error tints the card's border, the same signal a relation card gives.
 */
export function MediaFieldSection({
    field,
    error,
    changed,
    value,
    initialRefs,
    refsPending,
    uploads,
    readOnly,
    onChange,
    onBlur
}: {
    field: ContentField;
    error?: string;
    /** Whether the field has unsaved changes (drives the "Changed" badge). */
    changed: boolean;
    value: unknown;
    /** Server-resolved refs for the already-saved ids. */
    initialRefs?: MediaRef[];
    /** Whether those refs are still loading (a tile waits rather than guesses). */
    refsPending?: boolean;
    /** Editor-level staging for files that upload with the record. */
    uploads?: MediaPendingUploads;
    /** Whether the entry editor is a read-only preview (no `content:update`). */
    readOnly?: boolean;
    onChange: (value: unknown) => void;
    onBlur: () => void;
}) {
    const intl = useIntl();
    const controlId = `media-field-${field.name}`;
    const errorId = `${controlId}-error`;
    const titleId = `${controlId}-title`;
    const description = field.admin?.['description'];

    return (
        <Field
            data-invalid={!!error}
            // The field is a **composite** control (pick / upload / remove /
            // reorder), so it is named as a `group` rather than by a `<label
            // for>` pointing at one button — a label would *replace* that
            // button's own name, and "Cover image, button" tells the user
            // nothing about what pressing it does. Named as a group, a screen
            // reader reads "Cover image, group" and then each action by its
            // own name. Same shape as a relation card, which titles itself
            // with a heading for the same reason.
            aria-labelledby={titleId}
            className={cn(
                'gap-3 rounded-2xl border bg-card p-4',
                error && 'border-destructive/50'
            )}
        >
            <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        {/* `<h2>`, not `<h3>`: a media field is a top-level
                            section of the editor and the only heading above it
                            is the page's `<h1>`, so `<h3>` skipped a level —
                            the same fix as `FieldGroup` and
                            `RelationFieldSection` (`ORT-168`'s rule, caught
                            here once `heading-order` was switched on). The size
                            is a class, not the rank. */}
                        <h2 id={titleId} className="text-sm font-medium">
                            {labelOf(field)}
                            {field.required ? (
                                <span aria-hidden className="text-destructive">
                                    *
                                </span>
                            ) : null}
                        </h2>
                        {field.localized ? (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        type="button"
                                        className="inline-flex shrink-0 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    >
                                        <Globe
                                            aria-hidden
                                            className="size-3.5"
                                        />
                                        <span className="sr-only">
                                            {intl.formatMessage(
                                                messages.localizedLabel
                                            )}
                                        </span>
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {intl.formatMessage(messages.localized)}
                                </TooltipContent>
                            </Tooltip>
                        ) : null}
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
                        {intl.formatMessage(
                            field.multiple
                                ? messages.descMultiple
                                : messages.descSingle
                        )}
                    </p>
                </div>
            </div>

            <MediaFieldControl
                id={controlId}
                multiple={!!field.multiple}
                accept={field.accept as MediaAccept | undefined}
                required={field.required}
                value={value}
                initialRefs={initialRefs}
                refsPending={refsPending}
                uploads={uploads}
                readOnly={readOnly}
                invalid={!!error}
                describedBy={error ? errorId : undefined}
                onChange={onChange}
                onBlur={onBlur}
            />

            {!error && typeof description === 'string' ? (
                <FieldDescription>{description}</FieldDescription>
            ) : null}
            {error ? <FieldError id={errorId}>{error}</FieldError> : null}
        </Field>
    );
}
