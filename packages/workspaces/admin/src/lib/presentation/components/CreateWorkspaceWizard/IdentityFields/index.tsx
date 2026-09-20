import { defineMessages, useIntl } from 'react-intl';
import {
    Field,
    FieldDescription,
    FieldError,
    FieldGroup,
    FieldLabel,
    Input,
    Textarea
} from '@orthacms/design-system';
import { useBasicsSchema } from '../../../hooks/useBasicsSchema';
import type { UseSlugResult } from '../../../hooks/useSlug';
import type { WizardData } from '../../../../domain/types/wizard';
import { DESCRIPTION_MAX, NAME_MAX } from '../../../../domain/workspaceLimits';
import { ColorSwatchRow } from '../../ColorSwatchRow';
import { Monogram } from '../Monogram';
import { SlugField } from '../SlugField';

const messages = defineMessages({
    nameLabel: {
        id: 'workspaces.create.basics.nameLabel',
        defaultMessage: 'Workspace name'
    },
    namePlaceholder: {
        id: 'workspaces.create.basics.namePlaceholder',
        defaultMessage: 'e.g. Marketing site'
    },
    nameHelp: {
        id: 'workspaces.create.basics.nameHelp',
        defaultMessage:
            'Shown to team members in lists and navigation. You can change it later.'
    },
    descriptionLabel: {
        id: 'workspaces.create.basics.descriptionLabel',
        defaultMessage: 'Description'
    },
    descriptionOptional: {
        id: 'workspaces.create.basics.descriptionOptional',
        defaultMessage: 'Optional'
    },
    descriptionPlaceholder: {
        id: 'workspaces.create.basics.descriptionPlaceholder',
        defaultMessage: 'What is this workspace for?'
    },
    descriptionHelp: {
        id: 'workspaces.create.basics.descriptionHelp',
        defaultMessage:
            'A short note to help members recognise the workspace. Shown on the workspace card.'
    },
    counter: {
        id: 'workspaces.create.basics.counter',
        defaultMessage: '{count}/{max}'
    }
});

/** Props for {@link IdentityFields}. */
export type IdentityFieldsProps = {
    /** Current basics data. */
    data: WizardData;
    /** Merge a partial patch into the basics data. */
    update: (patch: Partial<WizardData>) => void;
    /** Slug controller (status + handlers) owned by the page. */
    slug: UseSlugResult;
};

/**
 * The basics step body: a live workspace monogram beside the name, the accent
 * color picker, the slug field with availability, and an optional description.
 */
export function IdentityFields({ data, update, slug }: IdentityFieldsProps) {
    const intl = useIntl();
    const schema = useBasicsSchema();

    const parsed = schema.safeParse({
        name: data.name,
        slug: data.slug,
        description: data.description
    });
    const issueFor = (field: 'name' | 'slug' | 'description') =>
        parsed.success
            ? undefined
            : parsed.error.issues.find((i) => i.path[0] === field)?.message;

    // Only surface errors once a field has content, so the form doesn't shout
    // before the user has typed anything.
    const nameError = data.name.length > 0 ? issueFor('name') : undefined;
    const slugError = data.slug.length > 0 ? issueFor('slug') : undefined;
    const descriptionError = issueFor('description');

    return (
        <FieldGroup>
            <Field data-invalid={!!nameError}>
                <FieldLabel htmlFor="workspace-name">
                    {intl.formatMessage(messages.nameLabel)}
                </FieldLabel>
                <div className="flex items-center gap-3">
                    <Monogram name={data.name} color={data.color} />
                    <Input
                        id="workspace-name"
                        value={data.name}
                        onChange={(event) =>
                            slug.onNameChange(event.target.value)
                        }
                        placeholder={intl.formatMessage(
                            messages.namePlaceholder
                        )}
                        autoComplete="off"
                        aria-invalid={!!nameError}
                    />
                </div>
                <div className="flex items-start justify-between gap-3">
                    {nameError ? (
                        <FieldError errors={[{ message: nameError }]} />
                    ) : (
                        <FieldDescription>
                            {intl.formatMessage(messages.nameHelp)}
                        </FieldDescription>
                    )}
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {intl.formatMessage(messages.counter, {
                            count: data.name.length,
                            max: NAME_MAX
                        })}
                    </span>
                </div>
            </Field>

            <ColorSwatchRow
                value={data.color}
                onChange={(color) => update({ color })}
            />

            <SlugField
                value={data.slug}
                slugEdited={data.slugEdited}
                status={slug.status}
                onChange={slug.onSlugChange}
                onRegenerate={slug.regenerate}
                error={slugError}
            />

            <Field data-invalid={!!descriptionError}>
                <FieldLabel htmlFor="workspace-description">
                    {intl.formatMessage(messages.descriptionLabel)}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                        ({intl.formatMessage(messages.descriptionOptional)})
                    </span>
                </FieldLabel>
                <Textarea
                    id="workspace-description"
                    className="shadow-none"
                    value={data.description}
                    onChange={(event) =>
                        update({ description: event.target.value })
                    }
                    placeholder={intl.formatMessage(
                        messages.descriptionPlaceholder
                    )}
                    aria-invalid={!!descriptionError}
                />
                <div className="flex items-start justify-between gap-3">
                    {descriptionError ? (
                        <FieldError errors={[{ message: descriptionError }]} />
                    ) : (
                        <FieldDescription>
                            {intl.formatMessage(messages.descriptionHelp)}
                        </FieldDescription>
                    )}
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {intl.formatMessage(messages.counter, {
                            count: data.description.length,
                            max: DESCRIPTION_MAX
                        })}
                    </span>
                </div>
            </Field>
        </FieldGroup>
    );
}
