import { useEffect, useMemo, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Alert,
    AlertDescription,
    Button,
    Checkbox,
    ConfirmDialog,
    Input,
    InputField,
    Label,
    MultiSelect,
    Switch
} from '@orthacms/design-system';
import type {
    WebhookEndpoint,
    WebhookEventOption
} from '../../../domain/types/webhook';
import { Plus, X } from 'lucide-react';
import type { ContentTypeOption } from '../../../domain/types/contentTypeOption';
import type { WorkspaceOption } from '../../../domain/types/workspaceOption';
import {
    fromHeaderRows,
    rejectionFor,
    toHeaderRows,
    type HeaderRow
} from '../../../domain/headerRules';
import {
    addContentTypeNames,
    contentTypeChoices,
    grantedContentTypes,
    parseContentTypeNames
} from '../../../domain/contentTypeChoices';
import type { SaveWebhookInput } from '../../../infrastructure/webhookGateway';

const messages = defineMessages({
    target: {
        id: 'webhooks.form.target',
        defaultMessage: 'Where deliveries go'
    },
    subscription: {
        id: 'webhooks.form.subscription',
        defaultMessage: 'What this endpoint receives'
    },
    name: { id: 'webhooks.form.name', defaultMessage: 'Name' },
    namePlaceholder: {
        id: 'webhooks.form.namePlaceholder',
        defaultMessage: 'Rebuild the storefront'
    },
    url: { id: 'webhooks.form.url', defaultMessage: 'URL' },
    urlHint: {
        id: 'webhooks.form.urlHint',
        defaultMessage: 'Must be https:// and reachable on the public internet.'
    },
    workspaces: {
        id: 'webhooks.form.workspaces',
        defaultMessage: 'Workspaces'
    },
    allWorkspaces: {
        id: 'webhooks.form.allWorkspaces',
        defaultMessage: 'All workspaces, including ones created later'
    },
    workspacesHint: {
        id: 'webhooks.form.workspacesHint',
        defaultMessage:
            'A record that belongs to no workspace is only sent to endpoints that take them all.'
    },
    workspacesPlaceholder: {
        id: 'webhooks.form.workspacesPlaceholder',
        defaultMessage: 'Choose workspaces'
    },
    events: { id: 'webhooks.form.events', defaultMessage: 'Events' },
    allEvents: {
        id: 'webhooks.form.allEvents',
        defaultMessage: 'Every event, including ones added later'
    },
    eventsPlaceholder: {
        id: 'webhooks.form.eventsPlaceholder',
        defaultMessage: 'Choose events'
    },
    contentTypes: {
        id: 'webhooks.form.contentTypes',
        defaultMessage: 'Content types'
    },
    allContentTypes: {
        id: 'webhooks.form.allContentTypes',
        defaultMessage: 'Every content type, including ones added later'
    },
    contentTypesPlaceholder: {
        id: 'webhooks.form.contentTypesPlaceholder',
        defaultMessage: 'Choose content types'
    },
    contentTypesHint: {
        id: 'webhooks.form.contentTypesHint',
        defaultMessage:
            'Pick from the types this build defines, or add one by machine name — a type you are about to create can be subscribed to before it exists.'
    },
    noContentTypes: {
        id: 'webhooks.form.noContentTypes',
        defaultMessage:
            'Nothing chosen yet, so this endpoint still receives every type.'
    },
    contentTypeSearch: {
        id: 'webhooks.form.contentTypeSearch',
        defaultMessage: 'Search, or type a machine name'
    },
    addContentType: {
        id: 'webhooks.form.addContentType',
        defaultMessage: 'Add “{name}”'
    },
    unknownContentType: {
        id: 'webhooks.form.unknownContentType',
        defaultMessage: '{name} (not defined here)'
    },
    contentTypesNeedWorkspace: {
        id: 'webhooks.form.contentTypesNeedWorkspace',
        defaultMessage:
            'Choose a workspace first — which types exist depends on what those workspaces were granted.'
    },
    contentTypesNoneGranted: {
        id: 'webhooks.form.contentTypesNoneGranted',
        defaultMessage:
            'The chosen workspaces were granted no content types, so there is nothing to pick from — a machine name can still be typed into the picker.'
    },
    contentTypesScoped: {
        id: 'webhooks.form.contentTypesScoped',
        defaultMessage: 'Listing only what the chosen workspaces were granted.'
    },
    status: { id: 'webhooks.form.status', defaultMessage: 'Status' },
    enabled: { id: 'webhooks.form.enabled', defaultMessage: 'Enabled' },
    disabled: { id: 'webhooks.form.disabled', defaultMessage: 'Disabled' },
    enabledHint: {
        id: 'webhooks.form.enabledHint',
        defaultMessage: 'Deliveries are sent as content changes.'
    },
    disabledHint: {
        id: 'webhooks.form.disabledHint',
        defaultMessage: 'Nothing is sent while this is off.'
    },
    disableTitle: {
        id: 'webhooks.form.disableTitle',
        defaultMessage: 'Turn this endpoint off?'
    },
    disableBody: {
        id: 'webhooks.form.disableBody',
        defaultMessage:
            'Events that happen while it is off are not queued for later — there is nothing to catch up on when you turn it back on. Deliveries already waiting are closed as failed.'
    },
    disableConfirm: {
        id: 'webhooks.form.disableConfirm',
        defaultMessage: 'Turn it off'
    },
    cancelDisable: {
        id: 'webhooks.form.cancelDisable',
        defaultMessage: 'Keep it on'
    },
    headers: {
        id: 'webhooks.form.headers',
        defaultMessage: 'Custom headers'
    },
    headersHint: {
        id: 'webhooks.form.headersHint',
        defaultMessage:
            'Sent with every delivery — an Authorization header, say, if the receiver wants one of its own on top of the signature.'
    },
    headerName: {
        id: 'webhooks.form.headerName',
        defaultMessage: 'Header name'
    },
    headerValue: {
        id: 'webhooks.form.headerValue',
        defaultMessage: 'Header value'
    },
    addHeader: { id: 'webhooks.form.addHeader', defaultMessage: 'Add header' },
    removeHeader: {
        id: 'webhooks.form.removeHeader',
        defaultMessage: 'Remove {name}'
    },
    headerReserved: {
        id: 'webhooks.form.headerReserved',
        defaultMessage:
            '“{name}” is reserved for the delivery’s own metadata and can’t be set here.'
    },
    headerMalformed: {
        id: 'webhooks.form.headerMalformed',
        defaultMessage: '“{name}” is not a valid header name.'
    },
    save: { id: 'webhooks.form.save', defaultMessage: 'Save' },
    create: { id: 'webhooks.form.create', defaultMessage: 'Create webhook' },
    cancel: { id: 'webhooks.form.cancel', defaultMessage: 'Cancel' },
    nameRequired: {
        id: 'webhooks.form.nameRequired',
        defaultMessage: 'Give the webhook a name.'
    },
    urlRequired: {
        id: 'webhooks.form.urlRequired',
        defaultMessage: 'Enter the URL deliveries should be posted to.'
    },
    noWorkspaces: {
        id: 'webhooks.form.noWorkspaces',
        defaultMessage:
            'Choose at least one workspace, or switch on “All workspaces”. As it stands this endpoint would receive nothing.'
    }
});

/** What the dialog is currently editing. */
export type WebhookFormValues = {
    name: string;
    url: string;
    enabled: boolean;
    allWorkspaces: boolean;
    workspaceIds: string[];
    allEvents: boolean;
    eventKinds: string[];
    allContentTypes: boolean;
    contentTypes: string[];
    headers: HeaderRow[];
};

/** The values a fresh dialog opens with. */
function emptyValues(): WebhookFormValues {
    return {
        name: '',
        url: '',
        enabled: true,
        // Defaults to false: reaching across every workspace should be
        // something someone chose, not something they forgot to narrow.
        allWorkspaces: false,
        workspaceIds: [],
        // Defaults to true, for the opposite reason: an endpoint that takes no
        // events is not a safer endpoint, it is a broken one.
        allEvents: true,
        eventKinds: [],
        // Same reasoning as events: a subscription narrowed to nothing is not
        // a safer one, so the default is the whole registry.
        allContentTypes: true,
        contentTypes: [],
        headers: []
    };
}

/** An existing endpoint, as the form edits it. */
function valuesOf(endpoint: WebhookEndpoint): WebhookFormValues {
    return {
        name: endpoint.name,
        url: endpoint.url,
        enabled: endpoint.enabled,
        allWorkspaces: endpoint.allWorkspaces,
        workspaceIds: endpoint.workspaceIds,
        allEvents: endpoint.eventKinds.length === 0,
        eventKinds: endpoint.eventKinds,
        allContentTypes: endpoint.contentTypes.length === 0,
        contentTypes: endpoint.contentTypes,
        headers: toHeaderRows(endpoint.headers)
    };
}

/**
 * Create and edit an endpoint.
 *
 * The three filters are each an "All…" toggle over a picker, and the toggle is
 * not cosmetic: it is the difference between "everything, including what does
 * not exist yet" and an enumerated list that silently stops covering the next
 * workspace or event kind. Turning one on sends **no** value for that filter,
 * which is exactly how the server reads "all".
 */
export function WebhookForm({
    endpoint,
    events,
    workspaces,
    contentTypes,
    pending,
    error,
    onSubmit,
    onCancel
}: {
    /** The endpoint being edited, or `undefined` when creating one. */
    endpoint?: WebhookEndpoint;
    events: WebhookEventOption[];
    workspaces: WorkspaceOption[];
    /**
     * The code-defined content types. Empty is a legitimate state — an
     * unreachable catalogue, or a build with no types yet — and the picker
     * still accepts a typed-in machine name.
     */
    contentTypes: ContentTypeOption[];
    pending: boolean;
    /** A server-side refusal to show above the footer (a rejected URL, say). */
    error: string | null;
    onSubmit: (input: SaveWebhookInput) => void;
    /** Leaves without saving — the page decides where that goes. */
    onCancel: () => void;
}) {
    const intl = useIntl();
    const [values, setValues] = useState<WebhookFormValues>(emptyValues);
    const [touched, setTouched] = useState(false);
    // Switching an endpoint off is not undoable in the way a form field is:
    // what happens while it is off is simply not recorded, so the switch asks.
    const [confirmDisable, setConfirmDisable] = useState(false);
    // Rows need a key that survives editing the name — using the name itself
    // would remount the input on every keystroke and lose the caret.
    const nextRowKey = useRef(0);

    // Seed once the endpoint arrives — the page mounts before its query
    // resolves. Keyed on the id rather than the object, so a background refetch
    // cannot discard edits in progress by re-seeding from the server's copy.
    // Depending on the id rather than the object is deliberate: a background
    // refetch hands back a new object with the same contents, and re-seeding on
    // that would discard whatever is half-typed. `useRef` holds the endpoint so
    // the effect can read it without listing it.
    const latest = useRef(endpoint);
    latest.current = endpoint;
    const endpointId = endpoint?.id;
    useEffect(() => {
        const seed = latest.current;
        if (!seed) return;
        setValues(valuesOf(seed));
        setTouched(false);
    }, [endpointId]);

    const eventOptions = useMemo(
        () =>
            events
                // `ping` is what the Send-test button produces; it is not
                // something an endpoint subscribes to.
                .filter((event) => event.kind !== 'ping')
                .map((event) => ({ value: event.kind, label: event.label })),
        [events]
    );

    const workspaceOptions = useMemo(
        () =>
            workspaces.map((workspace) => ({
                value: workspace.id,
                label: workspace.name
            })),
        [workspaces]
    );

    // The registry's types plus any selected name it does not know. The unknown
    // ones are labelled as such rather than hidden: an endpoint subscribed to a
    // type that has been removed, or to one with a typo in its name, is
    // receiving nothing and this is the only place that shows.
    // Narrowed to what the chosen workspaces were actually granted: a delivery
    // needs the event's workspace *and* its type to match, so a type none of
    // them can hold would never fire here.
    const offeredContentTypes = useMemo(
        () =>
            grantedContentTypes(contentTypes, workspaces, {
                allWorkspaces: values.allWorkspaces,
                workspaceIds: values.workspaceIds
            }),
        [contentTypes, workspaces, values.allWorkspaces, values.workspaceIds]
    );

    const contentTypeOptions = useMemo(
        () =>
            contentTypeChoices(offeredContentTypes, values.contentTypes).map(
                (choice) => ({
                    value: choice.value,
                    label: choice.known
                        ? choice.label
                        : intl.formatMessage(messages.unknownContentType, {
                              name: choice.value
                          })
                })
            ),
        [offeredContentTypes, values.contentTypes, intl]
    );

    // Which types are on offer is a question about the workspaces, so it cannot
    // be asked before they are chosen. An endpoint that already carries a type
    // filter is the exception — hiding it would leave a saved subscription
    // invisible and uneditable.
    const workspaceChosen =
        values.allWorkspaces || values.workspaceIds.length > 0;
    const contentTypesAnswerable =
        workspaceChosen || values.contentTypes.length > 0;
    // Chosen workspaces that were granted nothing: the picker is empty for a
    // reason worth stating, rather than looking broken.
    const noGrants =
        workspaceChosen &&
        !values.allWorkspaces &&
        offeredContentTypes.length === 0;

    const addTypedContentTypes = (raw: string) => {
        const names = parseContentTypeNames(raw);
        if (names.length === 0) return;
        setValues((prev) => ({
            ...prev,
            contentTypes: addContentTypeNames(prev.contentTypes, names)
        }));
    };

    const setHeaders = (next: HeaderRow[]) =>
        setValues((prev) => ({ ...prev, headers: next }));

    // Named rows only: an untouched empty row is someone about to type.
    const headerErrors = values.headers.map((row) => {
        if (row.name.trim().length === 0) return null;
        const rejection = rejectionFor(row.name);
        if (!rejection) return null;
        return intl.formatMessage(
            rejection === 'reserved'
                ? messages.headerReserved
                : messages.headerMalformed,
            { name: row.name.trim() }
        );
    });
    const headersValid = headerErrors.every((error) => error === null);

    const nameError =
        touched && values.name.trim().length === 0
            ? intl.formatMessage(messages.nameRequired)
            : undefined;
    const urlError =
        touched && values.url.trim().length === 0
            ? intl.formatMessage(messages.urlRequired)
            : undefined;
    // Not a hard error — the server accepts it — but an endpoint scoped to no
    // workspace receives nothing, which is never what someone meant.
    const emptyWorkspaces =
        !values.allWorkspaces && values.workspaceIds.length === 0;

    const submit = () => {
        setTouched(true);
        if (
            values.name.trim().length === 0 ||
            values.url.trim().length === 0 ||
            // The server refuses these too; stopping here keeps the message
            // beside the row that caused it.
            !headersValid
        ) {
            return;
        }
        onSubmit({
            name: values.name.trim(),
            url: values.url.trim(),
            enabled: values.enabled,
            allWorkspaces: values.allWorkspaces,
            workspaceIds: values.allWorkspaces ? [] : values.workspaceIds,
            // An empty list is how "all" is spelled on the wire, for both.
            eventKinds: values.allEvents ? [] : values.eventKinds,
            contentTypes: values.allContentTypes ? [] : values.contentTypes,
            headers: fromHeaderRows(values.headers)
        });
    };

    return (
        // Two columns on a wide screen, one on a narrow one. The split is the
        // two questions an endpoint answers — where a delivery goes, and what
        // is worth sending — which is also the order they are decided in.
        <div className="grid max-w-5xl gap-x-12 gap-y-8 lg:grid-cols-2">
            <section className="flex flex-col gap-4">
                <h2 className="text-sm font-medium text-muted-foreground">
                    {intl.formatMessage(messages.target)}
                </h2>
                <InputField
                    id="webhook-name"
                    label={intl.formatMessage(messages.name)}
                    value={values.name}
                    placeholder={intl.formatMessage(messages.namePlaceholder)}
                    error={nameError}
                    onChange={(event) =>
                        setValues((prev) => ({
                            ...prev,
                            name: event.target.value
                        }))
                    }
                />

                <InputField
                    id="webhook-url"
                    label={intl.formatMessage(messages.url)}
                    value={values.url}
                    type="url"
                    placeholder="https://example.com/hooks/ortha"
                    description={intl.formatMessage(messages.urlHint)}
                    error={urlError}
                    onChange={(event) =>
                        setValues((prev) => ({
                            ...prev,
                            url: event.target.value
                        }))
                    }
                />

                <fieldset className="flex flex-col gap-2">
                    <legend className="text-sm font-medium">
                        {intl.formatMessage(messages.status)}
                    </legend>
                    <div className="flex items-center gap-3">
                        <Switch
                            id="webhook-enabled"
                            checked={values.enabled}
                            onCheckedChange={(checked) => {
                                // Turning it on is harmless and immediate;
                                // turning it off loses whatever happens next,
                                // so only that direction asks.
                                if (checked) {
                                    setValues((prev) => ({
                                        ...prev,
                                        enabled: true
                                    }));
                                    return;
                                }
                                setConfirmDisable(true);
                            }}
                        />
                        <Label
                            htmlFor="webhook-enabled"
                            className="text-sm font-normal"
                        >
                            {intl.formatMessage(
                                values.enabled
                                    ? messages.enabled
                                    : messages.disabled
                            )}
                        </Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {intl.formatMessage(
                            values.enabled
                                ? messages.enabledHint
                                : messages.disabledHint
                        )}
                    </p>
                </fieldset>

                <fieldset className="flex flex-col gap-2">
                    <legend className="text-sm font-medium">
                        {intl.formatMessage(messages.headers)}
                    </legend>
                    {values.headers.map((row, index) => (
                        <div key={row.key} className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                                <Label
                                    htmlFor={`webhook-header-name-${row.key}`}
                                    className="sr-only"
                                >
                                    {intl.formatMessage(messages.headerName)}
                                </Label>
                                <Input
                                    id={`webhook-header-name-${row.key}`}
                                    value={row.name}
                                    placeholder="Authorization"
                                    className="font-mono text-sm"
                                    aria-invalid={
                                        headerErrors[index] !== null
                                            ? true
                                            : undefined
                                    }
                                    onChange={(event) =>
                                        setHeaders(
                                            values.headers.map((candidate) =>
                                                candidate.key === row.key
                                                    ? {
                                                          ...candidate,
                                                          name: event.target
                                                              .value
                                                      }
                                                    : candidate
                                            )
                                        )
                                    }
                                />
                                <Label
                                    htmlFor={`webhook-header-value-${row.key}`}
                                    className="sr-only"
                                >
                                    {intl.formatMessage(messages.headerValue)}
                                </Label>
                                <Input
                                    id={`webhook-header-value-${row.key}`}
                                    value={row.value}
                                    placeholder="Bearer …"
                                    className="font-mono text-sm"
                                    onChange={(event) =>
                                        setHeaders(
                                            values.headers.map((candidate) =>
                                                candidate.key === row.key
                                                    ? {
                                                          ...candidate,
                                                          value: event.target
                                                              .value
                                                      }
                                                    : candidate
                                            )
                                        )
                                    }
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={intl.formatMessage(
                                        messages.removeHeader,
                                        {
                                            name:
                                                row.name.trim() ||
                                                intl.formatMessage(
                                                    messages.headerName
                                                )
                                        }
                                    )}
                                    onClick={() =>
                                        setHeaders(
                                            values.headers.filter(
                                                (candidate) =>
                                                    candidate.key !== row.key
                                            )
                                        )
                                    }
                                >
                                    <X aria-hidden />
                                </Button>
                            </div>
                            {headerErrors[index] ? (
                                <p
                                    role="alert"
                                    className="text-xs text-destructive"
                                >
                                    {headerErrors[index]}
                                </p>
                            ) : null}
                        </div>
                    ))}
                    <div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                                setHeaders([
                                    ...values.headers,
                                    {
                                        key: `row-${nextRowKey.current++}`,
                                        name: '',
                                        value: ''
                                    }
                                ])
                            }
                        >
                            <Plus />
                            {intl.formatMessage(messages.addHeader)}
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {intl.formatMessage(messages.headersHint)}
                    </p>
                </fieldset>
            </section>

            <section className="flex flex-col gap-4">
                <h2 className="text-sm font-medium text-muted-foreground">
                    {intl.formatMessage(messages.subscription)}
                </h2>
                <fieldset className="flex flex-col gap-2">
                    <legend className="text-sm font-medium">
                        {intl.formatMessage(messages.workspaces)}
                    </legend>
                    <div className="flex items-center gap-2">
                        {/* The design-system Checkbox is a Radix button
                                (`role="checkbox"`), not a native input, so a
                                wrapping <label> would not name it — it needs an
                                id and an explicit `htmlFor`. */}
                        <Checkbox
                            id="webhook-all-workspaces"
                            checked={values.allWorkspaces}
                            onCheckedChange={(checked) =>
                                setValues((prev) => ({
                                    ...prev,
                                    allWorkspaces: checked === true
                                }))
                            }
                        />
                        <Label
                            htmlFor="webhook-all-workspaces"
                            className="text-sm font-normal"
                        >
                            {intl.formatMessage(messages.allWorkspaces)}
                        </Label>
                    </div>
                    {!values.allWorkspaces ? (
                        <>
                            {/* The trigger is a `Button role="combobox"`
                                    showing its own selection, so it has no name
                                    of its own — and a <legend> names the group,
                                    not the control inside it. Without this it
                                    is an unnamed button to a screen reader (axe
                                    `button-name`). */}
                            <Label
                                htmlFor="webhook-workspaces"
                                className="sr-only"
                            >
                                {intl.formatMessage(messages.workspaces)}
                            </Label>
                            <MultiSelect
                                id="webhook-workspaces"
                                options={workspaceOptions}
                                value={values.workspaceIds}
                                onChange={(next) =>
                                    setValues((prev) => ({
                                        ...prev,
                                        workspaceIds: next
                                    }))
                                }
                                placeholder={intl.formatMessage(
                                    messages.workspacesPlaceholder
                                )}
                            />
                        </>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                        {intl.formatMessage(messages.workspacesHint)}
                    </p>
                    {emptyWorkspaces ? (
                        <p className="text-xs text-destructive">
                            {intl.formatMessage(messages.noWorkspaces)}
                        </p>
                    ) : null}
                </fieldset>

                <fieldset className="flex flex-col gap-2">
                    <legend className="text-sm font-medium">
                        {intl.formatMessage(messages.events)}
                    </legend>
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="webhook-all-events"
                            checked={values.allEvents}
                            onCheckedChange={(checked) =>
                                setValues((prev) => ({
                                    ...prev,
                                    allEvents: checked === true
                                }))
                            }
                        />
                        <Label
                            htmlFor="webhook-all-events"
                            className="text-sm font-normal"
                        >
                            {intl.formatMessage(messages.allEvents)}
                        </Label>
                    </div>
                    {!values.allEvents ? (
                        <>
                            <Label htmlFor="webhook-events" className="sr-only">
                                {intl.formatMessage(messages.events)}
                            </Label>
                            <MultiSelect
                                id="webhook-events"
                                options={eventOptions}
                                value={values.eventKinds}
                                onChange={(next) =>
                                    setValues((prev) => ({
                                        ...prev,
                                        eventKinds: next
                                    }))
                                }
                                placeholder={intl.formatMessage(
                                    messages.eventsPlaceholder
                                )}
                            />
                        </>
                    ) : null}
                </fieldset>

                <fieldset className="flex flex-col gap-2">
                    <legend className="text-sm font-medium">
                        {intl.formatMessage(messages.contentTypes)}
                    </legend>
                    {!contentTypesAnswerable ? (
                        <p className="text-xs text-muted-foreground">
                            {intl.formatMessage(
                                messages.contentTypesNeedWorkspace
                            )}
                        </p>
                    ) : null}
                    {contentTypesAnswerable ? (
                        <div className="flex items-center gap-2">
                            <Checkbox
                                id="webhook-all-content-types"
                                checked={values.allContentTypes}
                                onCheckedChange={(checked) =>
                                    setValues((prev) => ({
                                        ...prev,
                                        allContentTypes: checked === true
                                    }))
                                }
                            />
                            <Label
                                htmlFor="webhook-all-content-types"
                                className="text-sm font-normal"
                            >
                                {intl.formatMessage(messages.allContentTypes)}
                            </Label>
                        </div>
                    ) : null}
                    {contentTypesAnswerable && !values.allContentTypes ? (
                        <>
                            <Label
                                htmlFor="webhook-content-types"
                                className="sr-only"
                            >
                                {intl.formatMessage(messages.contentTypes)}
                            </Label>
                            <MultiSelect
                                id="webhook-content-types"
                                options={contentTypeOptions}
                                value={values.contentTypes}
                                onChange={(next) =>
                                    setValues((prev) => ({
                                        ...prev,
                                        contentTypes: next
                                    }))
                                }
                                placeholder={intl.formatMessage(
                                    messages.contentTypesPlaceholder
                                )}
                                searchPlaceholder={intl.formatMessage(
                                    messages.contentTypeSearch
                                )}
                                // The search box doubles as the way in for
                                // a name the registry has no row for — one
                                // control instead of a picker beside a
                                // second field that meant the same thing.
                                onCreate={addTypedContentTypes}
                                createLabel={(name) =>
                                    intl.formatMessage(
                                        messages.addContentType,
                                        { name }
                                    )
                                }
                            />
                            {noGrants ? (
                                <p className="text-xs text-muted-foreground">
                                    {intl.formatMessage(
                                        messages.contentTypesNoneGranted
                                    )}
                                </p>
                            ) : null}
                            {!noGrants && values.contentTypes.length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                    {intl.formatMessage(
                                        messages.noContentTypes
                                    )}
                                </p>
                            ) : null}
                        </>
                    ) : null}
                    {contentTypesAnswerable && !noGrants ? (
                        <p className="text-xs text-muted-foreground">
                            {intl.formatMessage(messages.contentTypesHint)}
                            {!values.allContentTypes &&
                            !values.allWorkspaces &&
                            values.workspaceIds.length > 0
                                ? ` ${intl.formatMessage(
                                      messages.contentTypesScoped
                                  )}`
                                : ''}
                        </p>
                    ) : null}
                </fieldset>
            </section>

            {/* Full width under both columns: a refused URL is about the form,
                not about one of its halves. */}
            <div className="flex flex-col gap-4 lg:col-span-2">
                {error ? (
                    <Alert variant="destructive" role="alert">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                ) : null}

                <div className="flex items-center gap-2 border-t pt-4">
                    <Button onClick={submit} disabled={pending}>
                        {intl.formatMessage(
                            endpoint ? messages.save : messages.create
                        )}
                    </Button>
                    <Button variant="ghost" onClick={onCancel}>
                        {intl.formatMessage(messages.cancel)}
                    </Button>
                </div>
            </div>

            <ConfirmDialog
                open={confirmDisable}
                onOpenChange={setConfirmDisable}
                title={intl.formatMessage(messages.disableTitle)}
                description={intl.formatMessage(messages.disableBody)}
                confirmLabel={intl.formatMessage(messages.disableConfirm)}
                cancelLabel={intl.formatMessage(messages.cancelDisable)}
                confirmVariant="destructive"
                onConfirm={() => {
                    setValues((prev) => ({ ...prev, enabled: false }));
                    setConfirmDisable(false);
                }}
            />
        </div>
    );
}
