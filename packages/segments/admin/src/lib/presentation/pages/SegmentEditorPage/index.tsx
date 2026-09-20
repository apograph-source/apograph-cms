import { useEffect, useMemo, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { PageTopBar } from '@orthacms/shell-admin';
import { RequiredMark } from '@orthacms/content-admin';
import { useHasPermission } from '@orthacms/identity-admin';
import { ApiError, slugify, useDocumentTitle } from '@orthacms/utils-admin';
import {
    isValidSegment,
    validateSegment,
    SEGMENT_ISSUE,
    SEGMENT_KEY_MAX,
    SEGMENT_LABEL_MAX,
    SEGMENT_TAG_MAX,
    SEGMENT_TAGS_MAX,
    type SegmentIssue,
    type SegmentIssues
} from '@orthacms/segments-domain';
import {
    Alert,
    AlertDescription,
    Button,
    Container,
    ContainerHeader,
    Field,
    FieldDescription,
    FieldError,
    FieldLabel,
    Input,
    Spinner,
    Textarea,
    toast
} from '@orthacms/design-system';
import {
    SEGMENTS_MANAGE,
    SEGMENTS_READ,
    useCreateSegment,
    useSegment,
    useUpdateSegment
} from '../../../application/hooks';
import { SegmentWorkspacesField } from '../../components/SegmentWorkspacesField';
import { SegmentFormSkeleton } from '../../components/SegmentFormSkeleton';

const messages = defineMessages({
    directory: { id: 'segments.editor.directory', defaultMessage: 'Segments' },
    createTitle: {
        id: 'segments.editor.createTitle',
        defaultMessage: 'New audience'
    },
    createBody: {
        id: 'segments.editor.createBody',
        defaultMessage:
            'A group of readers you want to decide about — a customer, a plan, a region. Entries then say which audiences may read them.'
    },
    editTitle: {
        id: 'segments.editor.editTitle',
        defaultMessage: 'Edit audience'
    },
    requiredLegend: {
        id: 'segments.editor.requiredLegend',
        defaultMessage: 'Fields marked * are required.'
    },
    editBody: {
        id: 'segments.editor.editBody',
        defaultMessage:
            'Changing the tags changes who this audience matches — immediately, on every entry that names it.'
    },
    back: { id: 'segments.editor.back', defaultMessage: 'Back to audiences' },
    label: { id: 'segments.editor.label', defaultMessage: 'Name' },
    key: { id: 'segments.editor.key', defaultMessage: 'Key' },
    keyHint: {
        id: 'segments.editor.keyHint',
        defaultMessage:
            'Lowercase letters, digits, and . _ - — permanent, and the default reader tag.'
    },
    keyFixed: {
        id: 'segments.editor.keyFixed',
        defaultMessage:
            'The key is permanent: every entry that named this audience holds its id, and the key is what a reader tag defaults to.'
    },
    tags: { id: 'segments.editor.tags', defaultMessage: 'Reader tags' },
    tagsHint: {
        id: 'segments.editor.tagsHint',
        defaultMessage:
            'One per line — the identifiers your readers arrive with. Any one is enough to match. Leave empty to use just “{key}”.'
    },
    tagsCount: {
        id: 'segments.editor.tagsCount',
        defaultMessage: '{count} of {max} tags'
    },
    submitCreate: {
        id: 'segments.editor.submitCreate',
        defaultMessage: 'Create audience'
    },
    submitEdit: { id: 'segments.editor.submitEdit', defaultMessage: 'Save' },
    cancel: { id: 'segments.editor.cancel', defaultMessage: 'Cancel' },
    created: {
        id: 'segments.editor.created',
        defaultMessage: '“{name}” is ready to use on entries.'
    },
    saved: { id: 'segments.editor.saved', defaultMessage: 'Saved.' },
    writeError: {
        id: 'segments.editor.writeError',
        defaultMessage: 'Couldn’t save that. Please try again.'
    },
    loadError: {
        id: 'segments.editor.loadError',
        defaultMessage: 'Couldn’t load this audience.'
    },
    noAccess: {
        id: 'segments.editor.noAccess',
        defaultMessage:
            'Editing audiences needs the “segments:manage” permission.'
    },

    // One message per (field, reason) rather than a generic "invalid": the
    // whole point of validating here is telling somebody what to change.
    labelRequired: {
        id: 'segments.editor.labelRequired',
        defaultMessage: 'Give the audience a name.'
    },
    labelTooLong: {
        id: 'segments.editor.labelTooLong',
        defaultMessage: 'Keep the name under {max} characters.'
    },
    keyRequired: {
        id: 'segments.editor.keyRequired',
        defaultMessage: 'A key is required — it is how the audience is matched.'
    },
    keyMalformed: {
        id: 'segments.editor.keyMalformed',
        defaultMessage:
            'Use lowercase letters, digits, and . _ - only, starting with a letter or digit. It becomes a reader tag, so a space or a capital would match nobody.'
    },
    keyTooLong: {
        id: 'segments.editor.keyTooLong',
        defaultMessage: 'Keep the key under {max} characters.'
    },
    keyDuplicate: {
        id: 'segments.editor.keyDuplicate',
        defaultMessage: 'An audience with this key already exists.'
    },
    tagsTooMany: {
        id: 'segments.editor.tagsTooMany',
        defaultMessage: 'At most {max} tags.'
    },
    tagsTooLong: {
        id: 'segments.editor.tagsTooLong',
        defaultMessage: 'One of the tags is over {max} characters.'
    },
    tagsDuplicate: {
        id: 'segments.editor.tagsDuplicate',
        defaultMessage: 'The same tag is listed twice.'
    }
});

/** Which message a field's issue renders as, with its parameter. */
const COPY: Record<
    keyof SegmentIssues,
    Partial<
        Record<
            SegmentIssue,
            { message: { id: string; defaultMessage: string }; max?: number }
        >
    >
> = {
    label: {
        [SEGMENT_ISSUE.Required]: { message: messages.labelRequired },
        [SEGMENT_ISSUE.TooLong]: {
            message: messages.labelTooLong,
            max: SEGMENT_LABEL_MAX
        }
    },
    key: {
        [SEGMENT_ISSUE.Required]: { message: messages.keyRequired },
        [SEGMENT_ISSUE.Malformed]: { message: messages.keyMalformed },
        [SEGMENT_ISSUE.TooLong]: {
            message: messages.keyTooLong,
            max: SEGMENT_KEY_MAX
        },
        [SEGMENT_ISSUE.Duplicate]: { message: messages.keyDuplicate }
    },
    tags: {
        [SEGMENT_ISSUE.TooMany]: {
            message: messages.tagsTooMany,
            max: SEGMENT_TAGS_MAX
        },
        [SEGMENT_ISSUE.TooLong]: {
            message: messages.tagsTooLong,
            max: SEGMENT_TAG_MAX
        },
        [SEGMENT_ISSUE.Duplicate]: { message: messages.tagsDuplicate }
    }
};

/**
 * Create or edit an audience, at `/segments/new` and `/segments/:segmentId`.
 *
 * **A page rather than a dialog.** It was a dialog while an audience was three
 * short fields; it now also decides which workspaces may use it, which is a list
 * that grows with the installation. A modal that scrolls is a modal that has
 * outgrown being one — and a page gives each audience a URL, which is what makes
 * "here, look at this one" a link instead of a set of directions.
 *
 * **The rules come from the kernel**, not from a pattern spelled out here:
 * `@orthacms/segments-domain`'s `validateSegment` is the same function the
 * server's DTO reads its constants from, so this form cannot accept something
 * the API then refuses.
 *
 * **Errors appear on blur, not on the first keystroke.** A key is malformed for
 * the whole time somebody is typing it, and complaining from the second
 * character is noise about a state they are on their way out of.
 *
 * The **key is read-only when editing**, with the reason written next to it
 * rather than left as a greyed-out field nobody can interrogate.
 */
export function SegmentEditorPage() {
    const intl = useIntl();
    const navigate = useNavigate();
    const { segmentId } = useParams<{ segmentId: string }>();
    const editing = segmentId !== undefined;

    const canRead = useHasPermission(SEGMENTS_READ);
    const canManage = useHasPermission(SEGMENTS_MANAGE);
    const loaded = useSegment(editing ? segmentId : undefined);
    const segment = loaded.data;

    const create = useCreateSegment();
    const update = useUpdateSegment();
    const submitting = create.isPending || update.isPending;

    const [label, setLabel] = useState('');
    const [key, setKey] = useState('');
    const [keyTouched, setKeyTouched] = useState(false);
    const [tags, setTags] = useState('');
    const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
    const [blurred, setBlurred] = useState<Record<string, boolean>>({});
    const [submitted, setSubmitted] = useState(false);
    // The key the server refused with a 409 — one somebody else took a moment
    // ago. Held as the key rather than a flag so the message clears itself the
    // moment a different one is typed.
    const [keyConflict, setKeyConflict] = useState<string | null>(null);

    // Seed from the loaded segment. Keyed on the row's identity rather than the
    // object, so a background refetch cannot overwrite what is being typed.
    useEffect(() => {
        if (!segment) return;
        setLabel(segment.label);
        setKey(segment.key);
        setKeyTouched(true);
        setTags(segment.tags.join('\n'));
        setWorkspaceIds(segment.workspaceIds);
    }, [segment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    useDocumentTitle(
        intl.formatMessage(editing ? messages.editTitle : messages.createTitle)
    );

    // The key tracks the name until somebody takes it over — the same
    // convention the workspace slug follows, and here for the same reason: the
    // derived value is right almost always, and typing in the field says it
    // isn't.
    const derivedKey = keyTouched ? key : slugify(label);
    const tagList = useMemo(
        () =>
            tags
                .split('\n')
                .map((tag) => tag.trim())
                .filter(Boolean),
        [tags]
    );

    // Editing sends no key, so there is nothing to check it against; creating
    // relies on the server's 409, which is the only complete answer now that the
    // directory is paginated — a local list of "existing keys" would be one page
    // of them, and a check that is right most of the time is worse than one that
    // is honestly late.
    const issues = validateSegment({
        ...(editing ? {} : { key: derivedKey }),
        label,
        tags: tagList
    });
    const valid = isValidSegment(issues);

    /** The message for a field, once it is due to be shown. */
    const errorFor = (field: keyof SegmentIssues): string | undefined => {
        if (!submitted && !blurred[field]) return undefined;
        const issue = issues[field];
        if (!issue) return undefined;
        const entry = COPY[field][issue];
        if (!entry) return undefined;
        return intl.formatMessage(entry.message, { max: entry.max });
    };

    const labelError = errorFor('label');
    const keyError =
        keyConflict !== null && keyConflict === derivedKey && !editing
            ? intl.formatMessage(messages.keyDuplicate)
            : errorFor('key');
    const tagsError = errorFor('tags');
    const onBlur = (field: string) => () =>
        setBlurred((current) => ({ ...current, [field]: true }));

    const bar = (
        <PageTopBar
            icon={ShieldCheck}
            crumbs={[
                {
                    key: 'segments',
                    label: intl.formatMessage(messages.directory),
                    to: '/segments'
                },
                {
                    key: 'editor',
                    label: intl.formatMessage(
                        editing ? messages.editTitle : messages.createTitle
                    )
                }
            ]}
        />
    );

    const failed = () => toast.error(intl.formatMessage(messages.writeError));
    const leave = () => navigate('/segments');

    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        setSubmitted(true);
        if (!valid || submitting) return;
        setKeyConflict(null);

        if (editing && segmentId) {
            update.mutate(
                {
                    id: segmentId,
                    label: label.trim(),
                    tags: tagList,
                    workspaceIds
                },
                {
                    onSuccess: () => {
                        toast.success(intl.formatMessage(messages.saved));
                        leave();
                    },
                    onError: failed
                }
            );
            return;
        }

        create.mutate(
            {
                key: derivedKey,
                label: label.trim(),
                // An empty list means "use the key", which the server fills in —
                // sending `[]` would be an audience matching nobody.
                ...(tagList.length ? { tags: tagList } : {}),
                workspaceIds
            },
            {
                onSuccess: (created) => {
                    toast.success(
                        intl.formatMessage(messages.created, {
                            name: created.label
                        })
                    );
                    leave();
                },
                onError: (error) => {
                    // A taken key belongs on the field, not in a toast about a
                    // form that is still on screen and still looks fine.
                    if (error instanceof ApiError && error.status === 409) {
                        setKeyConflict(derivedKey);
                        return;
                    }
                    failed();
                }
            }
        );
    };

    if (!canRead || !canManage) {
        return (
            <>
                {bar}
                <Container>
                    <ContainerHeader
                        title={intl.formatMessage(
                            editing ? messages.editTitle : messages.createTitle
                        )}
                    />
                    <p className="mt-6 text-sm text-muted-foreground">
                        {intl.formatMessage(messages.noAccess)}
                    </p>
                </Container>
            </>
        );
    }

    if (editing && loaded.isPending) {
        return (
            <>
                {bar}
                <Container>
                    {/* The same skeleton the route's own chunk fallback draws,
                        so loading the page and loading the audience on it are
                        one shape rather than two. */}
                    <SegmentFormSkeleton />
                </Container>
            </>
        );
    }

    if (editing && loaded.isError) {
        return (
            <>
                {bar}
                <Container>
                    <Alert variant="destructive" role="alert" className="mt-6">
                        <AlertDescription>
                            {intl.formatMessage(messages.loadError)}
                        </AlertDescription>
                    </Alert>
                    <Button variant="outline" className="mt-4" asChild>
                        <Link to="/segments">
                            <ArrowLeft aria-hidden />
                            {intl.formatMessage(messages.back)}
                        </Link>
                    </Button>
                </Container>
            </>
        );
    }

    return (
        <>
            {bar}
            <Container>
                <Button variant="ghost" size="sm" className="mb-2" asChild>
                    <Link to="/segments">
                        <ArrowLeft aria-hidden />
                        {intl.formatMessage(messages.back)}
                    </Link>
                </Button>
                <ContainerHeader
                    title={intl.formatMessage(
                        editing ? messages.editTitle : messages.createTitle
                    )}
                    subtitle={intl.formatMessage(
                        editing ? messages.editBody : messages.createBody
                    )}
                />

                {/* `noValidate` because the messages are ours: the browser's
                    bubble says something else, in a different language, and
                    disappears on the next keystroke. */}
                <form
                    noValidate
                    className="mt-6 flex max-w-2xl flex-col gap-6"
                    onSubmit={submit}
                >
                    {/* The convention, stated once in the page for everyone.
                        The asterisks themselves are `aria-hidden` — the controls
                        carry `aria-required`, which is what is announced — so a
                        sighted reader who does not know the convention needs
                        this line, and nothing about it should be hoverable. */}
                    <p className="text-xs text-muted-foreground">
                        {intl.formatMessage(messages.requiredLegend)}
                    </p>

                    <Field data-invalid={Boolean(labelError) || undefined}>
                        <FieldLabel htmlFor="segment-label">
                            {intl.formatMessage(messages.label)}
                            <RequiredMark />
                        </FieldLabel>
                        <Input
                            id="segment-label"
                            value={label}
                            autoFocus
                            // `aria-required`, not the HTML `required`: the form
                            // is `noValidate` (the submit handler owns the
                            // messages), so the native attribute would carry the
                            // semantics of a check that never runs.
                            aria-required
                            aria-invalid={Boolean(labelError)}
                            aria-describedby={
                                labelError ? 'segment-label-error' : undefined
                            }
                            onBlur={onBlur('label')}
                            onChange={(event) => setLabel(event.target.value)}
                        />
                        {labelError ? (
                            <FieldError id="segment-label-error">
                                {labelError}
                            </FieldError>
                        ) : null}
                    </Field>

                    <Field data-invalid={Boolean(keyError) || undefined}>
                        <FieldLabel htmlFor="segment-key">
                            {intl.formatMessage(messages.key)}
                            {/* Marked even while editing: it is still a value
                                the audience cannot be without, and the field
                                being read-only is said by the hint under it
                                rather than by dropping the mark. */}
                            <RequiredMark />
                        </FieldLabel>
                        <Input
                            id="segment-key"
                            value={derivedKey}
                            readOnly={editing}
                            aria-required
                            aria-invalid={Boolean(keyError)}
                            aria-describedby={
                                keyError
                                    ? 'segment-key-error'
                                    : 'segment-key-hint'
                            }
                            onBlur={onBlur('key')}
                            onChange={(event) => {
                                setKeyTouched(true);
                                setKey(event.target.value);
                            }}
                        />
                        {keyError ? (
                            <FieldError id="segment-key-error">
                                {keyError}
                            </FieldError>
                        ) : (
                            <FieldDescription id="segment-key-hint">
                                {intl.formatMessage(
                                    editing
                                        ? messages.keyFixed
                                        : messages.keyHint
                                )}
                            </FieldDescription>
                        )}
                    </Field>

                    <Field data-invalid={Boolean(tagsError) || undefined}>
                        <FieldLabel htmlFor="segment-tags">
                            {intl.formatMessage(messages.tags)}
                        </FieldLabel>
                        {/* A textarea of one per line rather than a chip input:
                            the common case is pasting a list out of the system
                            that owns the identifiers, and a chip editor turns a
                            paste of forty plan codes into forty interactions. */}
                        <Textarea
                            id="segment-tags"
                            rows={5}
                            value={tags}
                            placeholder={derivedKey || 'acme'}
                            aria-invalid={Boolean(tagsError)}
                            aria-describedby={
                                tagsError
                                    ? 'segment-tags-error'
                                    : 'segment-tags-hint'
                            }
                            onBlur={onBlur('tags')}
                            onChange={(event) => setTags(event.target.value)}
                        />
                        {tagsError ? (
                            <FieldError id="segment-tags-error">
                                {tagsError}
                            </FieldError>
                        ) : (
                            <FieldDescription id="segment-tags-hint">
                                {intl.formatMessage(messages.tagsHint, {
                                    key: derivedKey || 'acme'
                                })}
                                {tagList.length > 0
                                    ? ` · ${intl.formatMessage(
                                          messages.tagsCount,
                                          {
                                              count: tagList.length,
                                              max: SEGMENT_TAGS_MAX
                                          }
                                      )}`
                                    : ''}
                            </FieldDescription>
                        )}
                    </Field>

                    <SegmentWorkspacesField
                        value={workspaceIds}
                        onChange={setWorkspaceIds}
                        disabled={submitting}
                    />

                    <div className="flex items-center gap-2">
                        {/* Not disabled on invalid input: a dead button explains
                            nothing, and pressing it is how somebody with nothing
                            focused finds out which field is wrong. */}
                        <Button type="submit" disabled={submitting}>
                            {submitting ? <Spinner /> : null}
                            {intl.formatMessage(
                                editing
                                    ? messages.submitEdit
                                    : messages.submitCreate
                            )}
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={submitting}
                            onClick={leave}
                        >
                            {intl.formatMessage(messages.cancel)}
                        </Button>
                    </div>
                </form>
            </Container>
        </>
    );
}
