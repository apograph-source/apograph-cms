import { defineMessages, useIntl } from 'react-intl';
import { AlertCircle, Check, RotateCcw, X } from 'lucide-react';
import {
    Button,
    Field,
    FieldDescription,
    FieldError,
    FieldLabel,
    Input,
    Spinner
} from '@orthacms/design-system';
import { SlugStatus } from '../../../../domain/types/wizard';

const messages = defineMessages({
    label: {
        id: 'workspaces.create.basics.slugLabel',
        defaultMessage: 'Slug'
    },
    placeholder: {
        id: 'workspaces.create.basics.slugPlaceholder',
        defaultMessage: 'marketing-site'
    },
    help: {
        id: 'workspaces.create.basics.slugHelp',
        defaultMessage:
            'A unique identifier for the workspace. Cannot be changed after creation.'
    },
    regenerate: {
        id: 'workspaces.create.basics.slugRegenerate',
        defaultMessage: 'Regenerate from name'
    },
    checking: {
        id: 'workspaces.create.basics.slugChecking',
        defaultMessage: 'Checking availability…'
    },
    available: {
        id: 'workspaces.create.basics.slugAvailable',
        defaultMessage: 'Available'
    },
    taken: {
        id: 'workspaces.create.basics.slugTaken',
        defaultMessage: 'That slug is already taken.'
    },
    unknown: {
        id: 'workspaces.create.basics.slugUnknown',
        defaultMessage:
            'Couldn’t check whether this slug is free, so you can’t continue yet. Please try again.'
    }
});

/** The live availability line shown beneath the slug input. */
function SlugStatusLine({ status }: { status: SlugStatus }) {
    const intl = useIntl();

    if (status === SlugStatus.Checking) {
        return (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Spinner className="size-3.5" />
                {intl.formatMessage(messages.checking)}
            </span>
        );
    }
    if (status === SlugStatus.Available) {
        return (
            <span className="flex items-center gap-1.5 text-sm text-success">
                <Check className="size-3.5" />
                {intl.formatMessage(messages.available)}
            </span>
        );
    }
    if (status === SlugStatus.Taken) {
        return (
            <span className="flex items-center gap-1.5 text-sm text-destructive">
                <X className="size-3.5" />
                {intl.formatMessage(messages.taken)}
            </span>
        );
    }
    if (status === SlugStatus.Unknown) {
        // `role="alert"` because this one appears only on a failure the user
        // didn't cause and must act on — the other states are passive progress
        // reporting and would be noise if announced.
        return (
            <span
                role="alert"
                className="flex items-center gap-1.5 text-sm text-destructive"
            >
                <AlertCircle className="size-3.5" />
                {intl.formatMessage(messages.unknown)}
            </span>
        );
    }
    return null;
}

/** Props for {@link SlugField}. */
export type SlugFieldProps = {
    /** Current slug value. */
    value: string;
    /** Whether the user has manually edited the slug. */
    slugEdited: boolean;
    /** Live availability status. */
    status: SlugStatus;
    /** Called when the slug input changes. */
    onChange: (value: string) => void;
    /** Called when the regenerate button is pressed. */
    onRegenerate: () => void;
    /** Localized shape error (e.g. pattern violation). */
    error?: string;
};

/**
 * Slug input with a regenerate button (shown once the slug has been manually
 * edited) and a live availability line. Shape errors take over the helper slot;
 * otherwise the helper text and availability status show.
 */
export function SlugField({
    value,
    slugEdited,
    status,
    onChange,
    onRegenerate,
    error
}: SlugFieldProps) {
    const intl = useIntl();

    return (
        <Field data-invalid={!!error}>
            <FieldLabel htmlFor="workspace-slug">
                {intl.formatMessage(messages.label)}
            </FieldLabel>
            <div className="flex items-center gap-2">
                <Input
                    id="workspace-slug"
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder={intl.formatMessage(messages.placeholder)}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={!!error}
                />
                {slugEdited ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={onRegenerate}
                        title={intl.formatMessage(messages.regenerate)}
                        aria-label={intl.formatMessage(messages.regenerate)}
                    >
                        <RotateCcw />
                    </Button>
                ) : null}
            </div>
            {error ? (
                <FieldError errors={[{ message: error }]} />
            ) : (
                <>
                    <FieldDescription>
                        {intl.formatMessage(messages.help)}
                    </FieldDescription>
                    <SlugStatusLine status={status} />
                </>
            )}
        </Field>
    );
}
