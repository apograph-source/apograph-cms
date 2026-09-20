import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import {
    Alert,
    AlertDescription,
    AlertTitle,
    Button,
    Container,
    ContainerHeader,
    InputField,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Spinner,
    Textarea,
    toast
} from '@orthacms/design-system';
import {
    QueryBuilderPanel,
    QueryBuilderSummary,
    countRules,
    jsonFilterToTree,
    treeToJsonFilter,
    type FilterGroup
} from '@orthacms/query-builder-admin';
import {
    RECORDS_FILTER_FIELDS_SLOT,
    RelationValuePicker,
    RequiredMark,
    useContentSchema,
    useContentTypes,
    useFilterFields,
    type ContentTypeDetail
} from '@orthacms/content-admin';
import { useHasPermission } from '@orthacms/identity-admin';
import { PageTopBar } from '@orthacms/shell-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { BellRing, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { useAlarmRules } from '../../../application/useAlarmRules';
import {
    useCreateAlarmRule,
    usePreviewAlarmRule,
    useUpdateAlarmRule
} from '../../../application/useAlarmRuleMutations';
import { ALARM_SEVERITIES, type AlarmSeverity } from '../../../types/alarm';
import { AlarmsNoAccess } from '../../components/AlarmsNoAccess';
import { AlarmsSkeleton } from '../../components/AlarmsSkeleton';

const messages = defineMessages({
    title: { id: 'alarms.editor.title', defaultMessage: 'Edit alarm' },
    createTitle: {
        id: 'alarms.editor.createTitle',
        defaultMessage: 'New alarm'
    },
    createSubtitle: {
        id: 'alarms.editor.createSubtitle',
        defaultMessage:
            'Pick what to watch, then say what counts as a problem. Nothing is ever blocked — a match is flagged, not refused.'
    },
    crumbNew: { id: 'alarms.editor.crumbNew', defaultMessage: 'New alarm' },
    contentType: {
        id: 'alarms.editor.contentType',
        defaultMessage: 'What to watch'
    },
    contentTypeHint: {
        id: 'alarms.editor.contentTypeHint',
        defaultMessage:
            'The collection this alarm checks. It cannot be changed later — every finding is about a record of this type.'
    },
    contentTypePlaceholder: {
        id: 'alarms.editor.contentTypePlaceholder',
        defaultMessage: 'Choose a collection…'
    },
    pickTypeFirst: {
        id: 'alarms.editor.pickTypeFirst',
        defaultMessage: 'Choose a collection above to set conditions.'
    },
    create: { id: 'alarms.editor.create', defaultMessage: 'Create alarm' },
    created: {
        id: 'alarms.editor.created',
        defaultMessage:
            '{name} created — {open, plural, =0 {nothing flagged yet} one {# record flagged} other {# records flagged}}.'
    },
    subtitle: {
        id: 'alarms.editor.subtitle',
        defaultMessage:
            'Watching {contentType}. Changing the condition re-checks the whole collection.'
    },
    crumbAlarms: { id: 'alarms.editor.crumbAlarms', defaultMessage: 'Alarms' },
    notFoundTitle: {
        id: 'alarms.editor.notFoundTitle',
        defaultMessage: 'No such alarm'
    },
    notFoundBody: {
        id: 'alarms.editor.notFoundBody',
        defaultMessage: 'It may have been deleted. Go back to the alarms list.'
    },
    back: { id: 'alarms.editor.back', defaultMessage: 'Back to alarms' },
    cancel: { id: 'alarms.editor.cancel', defaultMessage: 'Cancel' },
    name: { id: 'alarms.editor.name', defaultMessage: 'Alarm name' },
    findingTitle: {
        id: 'alarms.editor.findingTitle',
        defaultMessage: 'What editors will see'
    },
    findingHint: {
        id: 'alarms.editor.findingHint',
        defaultMessage: 'Shown on the record itself: “Author is not published”.'
    },
    description: {
        id: 'alarms.editor.description',
        defaultMessage: 'Notes (optional)'
    },
    severity: { id: 'alarms.editor.severity', defaultMessage: 'Level' },
    severityError: {
        id: 'alarms.editor.severityError',
        defaultMessage: 'Error'
    },
    severityWarn: {
        id: 'alarms.editor.severityWarn',
        defaultMessage: 'Warning'
    },
    severityInfo: { id: 'alarms.editor.severityInfo', defaultMessage: 'Info' },
    condition: {
        id: 'alarms.editor.condition',
        defaultMessage: 'Flag a record when…'
    },
    conditionHint: {
        id: 'alarms.editor.conditionHint',
        defaultMessage:
            'The same conditions you filter the records list with. A record is flagged for as long as it matches all of them.'
    },
    editCondition: {
        id: 'alarms.editor.editCondition',
        defaultMessage: 'Edit conditions'
    },
    doneEditing: {
        id: 'alarms.editor.doneEditing',
        defaultMessage: 'Done editing'
    },
    noCondition: {
        id: 'alarms.editor.noCondition',
        defaultMessage:
            'No conditions yet. A rule needs at least one, or it would flag every record in the collection.'
    },
    matching: {
        id: 'alarms.editor.matching',
        defaultMessage: 'Checking how many records match…'
    },
    matches: {
        id: 'alarms.editor.matches',
        defaultMessage:
            '{matched, plural, =0 {No records match} one {# record matches} other {# records match}} right now, out of {total}.'
    },
    matchesEverything: {
        id: 'alarms.editor.matchesEverything',
        defaultMessage:
            'That is every record in the collection — the condition is probably inverted.'
    },
    matchFailed: {
        id: 'alarms.editor.matchFailed',
        defaultMessage: 'Could not count the matches: {reason}'
    },
    recount: { id: 'alarms.editor.recount', defaultMessage: 'Re-check' },
    unsaved: {
        id: 'alarms.editor.unsaved',
        defaultMessage:
            'Conditions changed. Nothing is flagged or cleared until you save.'
    },
    brokenTitle: {
        id: 'alarms.editor.brokenTitle',
        defaultMessage: 'This condition no longer matches the content type'
    },
    save: { id: 'alarms.editor.save', defaultMessage: 'Save changes' },
    requiredLegend: {
        id: 'alarms.editor.requiredLegend',
        defaultMessage:
            'Fields marked * are required, and an alarm needs at least one condition.'
    },
    saved: { id: 'alarms.editor.saved', defaultMessage: 'Alarm saved.' },
    saveFailed: {
        id: 'alarms.editor.saveFailed',
        defaultMessage: 'The alarm could not be saved: {reason}'
    }
});

/**
 * Stands in for a content type that has not loaded yet.
 *
 * A module constant rather than an inline literal: it is passed to slot hooks
 * on every render, and a fresh object each time would defeat any memoisation a
 * contributor does on its identity.
 */
const NO_SCHEMA: ContentTypeDetail = {
    name: '',
    kind: 'collection',
    label: '',
    fields: []
};

/** The severity labels, keyed the same way the type is. */
const SEVERITY_LABELS = {
    error: messages.severityError,
    warn: messages.severityWarn,
    info: messages.severityInfo
} as const;

/** Props for {@link AlarmRuleEditorPage}. */
export type AlarmRuleEditorPageProps = {
    /**
     * `'create'` mounts the same page as a blank form with a content-type
     * picker; `'edit'` (the default) loads the rule named by the route.
     *
     * One component for both, because the two forms are the same form: the
     * condition builder, the match count, the wording and the level are
     * identical, and the only genuine difference is whether the collection is
     * chosen or already fixed. A second page would be that whole surface
     * duplicated for one `<Select>`.
     */
    mode?: 'create' | 'edit';
};

/**
 * Creates or edits one alarm: its wording, its level, and its conditions.
 *
 * The conditions are edited with the **records list's own query builder**, over
 * the same `/content-schema/:name/filter-fields` surface — so a rule can only
 * ever say something the list can say, and there is no second grammar to learn,
 * document or keep in step with the engine.
 *
 * **"Save as alarm" in the records toolbar is still the better path**, and the
 * one the docs lead with: there the condition is already built and already
 * verified against rows the author has looked at. Creating from here starts
 * from a blank condition over a collection nobody has inspected, which is how
 * you get an alarm that matches everything — so this form leans hard on the
 * live match count to close that gap before the alarm is saved.
 *
 * ### Why the condition block looks the way it does
 *
 * In the records list, Apply has an obvious consequence: the table underneath
 * re-runs. Here there is no table, so committing a condition changed nothing a
 * person could see and Apply read as a dead button. Two things fix that, and
 * both are on screen at rest rather than behind another click:
 *
 * - **The committed conditions render as chips** (`QueryBuilderSummary`), so
 *   Apply visibly moves the edit out of the builder and into the rule.
 * - **The match count re-runs on its own** whenever those conditions change.
 *   It was behind a "Count matches" button, which is the one number that tells
 *   you whether the rule you just wrote means what you think, and it only
 *   appeared if you knew to ask.
 *
 * Apply and Save then have visibly different jobs — Apply changes the chips,
 * Save re-checks the collection — and the unsaved notice says so in words.
 */
export function AlarmRuleEditorPage({
    mode = 'edit'
}: AlarmRuleEditorPageProps = {}) {
    const intl = useIntl();
    const navigate = useNavigate();
    const workspace = useCurrentWorkspace();
    const { ruleId } = useParams<{ ruleId: string }>();
    const canRead = useHasPermission('alarms:read');
    const canManage = useHasPermission('alarms:manage');
    const isCreate = mode === 'create';

    const rules = useAlarmRules(canRead && !isCreate);
    const rule = useMemo(
        () => rules.data?.find((candidate) => candidate.id === ruleId),
        [rules.data, ruleId]
    );

    // Only meaningful while creating; an existing rule's type is fixed, because
    // changing it would make every finding it has opened a statement about the
    // wrong collection.
    const [contentType, setContentType] = useState('');
    const [name, setName] = useState('');
    const [findingTitle, setFindingTitle] = useState('');
    const [description, setDescription] = useState('');
    const [severity, setSeverity] = useState<AlarmSeverity>('warn');
    const [tree, setTree] = useState<FilterGroup | null>(null);
    const [builderOpen, setBuilderOpen] = useState(false);

    // Seed the form once the rule arrives. Keyed on the id, not the object, so
    // a background refetch cannot discard edits in progress by re-seeding from
    // the server's copy.
    useEffect(() => {
        if (!rule) return;
        setName(rule.name);
        setFindingTitle(rule.findingTitle);
        setDescription(rule.description ?? '');
        setSeverity(rule.severity);
        // `jsonFilterToTree` takes the wire JSON as a string — the same
        // thing the records list has in `?filter=` — while the rule stores
        // it parsed. One `stringify` beats a second parser.
        setTree(jsonFilterToTree(JSON.stringify(rule.filter)));
        // Keyed on the id alone, deliberately: depending on the rule object
        // would let a background refetch re-seed the form and discard edits in
        // progress.
    }, [rule?.id]);

    // The type the whole page is about: chosen while creating, fixed while
    // editing.
    const watchedType = isCreate ? contentType : (rule?.contentType ?? '');

    const filterFields = useFilterFields(watchedType || undefined);

    // **The records list's *full* filterable surface, not just the server half.**
    // A rule is created from a list filter, and that list offers
    // slot-contributed fields alongside the server-derived ones — i18n's
    // `localeCount` / `hasLocale` / `missingLocale`, answered by the same
    // plugin's virtual-field subqueries at evaluation time. Reading only
    // `useFilterFields` here meant a rule saved over one of those came back as
    // "This field is no longer available — pick another one", and the Apply
    // gate then refused every edit to it, because it rejects any rule whose
    // field it cannot resolve.
    //
    // Hook-in-a-loop is rules-of-hooks-safe: slot items are registered once at
    // boot and never change, so the call order is stable across renders — the
    // same argument the records list documents at its own call site.
    const schema = useContentSchema(watchedType, Boolean(watchedType));
    // `useFields` is a **hook**, so it is called unconditionally with a
    // placeholder until the real schema lands. Guarding the call on
    // `schema.data` instead changed the hook count between renders and took the
    // page down with the error boundary — React counts hooks, not intentions.
    // The placeholder is a module constant so its identity is stable, and a
    // contributor handed it returns nothing (i18n's, for one, is empty for a
    // type with no `i18n` flag).
    const slotFilterFields = RECORDS_FILTER_FIELDS_SLOT.getItems().flatMap(
        (item) => item.useFields(schema.data ?? NO_SCHEMA)
    );
    // Not memoised, matching the records list's own call site: the slot's
    // hooks return a fresh array each render anyway, so a `useMemo` over it
    // would recompute every time while looking as though it did not.
    const fields = [...filterFields.fields, ...slotFilterFields];

    const types = useContentTypes(canRead && isCreate);
    const create = useCreateAlarmRule();
    const update = useUpdateAlarmRule();
    const preview = usePreviewAlarmRule();

    /**
     * The current conditions as the wire tree the API stores.
     *
     * `treeToJsonFilter` produces the JSON string the records list puts in its
     * URL; the rules API takes the same tree as an object, so it is parsed back
     * rather than re-serialised by a second implementation.
     *
     * **`relativeDates` is the important argument.** By default a "within the
     * last N days" rule is serialised as a concrete cutoff — right for a shared
     * link, and silently wrong for a stored rule, which would then mean "since
     * the day I was written" for ever. This is the one place in the admin where
     * a filter is stored rather than linked, so it is the one place that asks
     * for the relative spelling.
     */
    const filterJson = useMemo((): Record<string, unknown> | null => {
        const json = tree
            ? treeToJsonFilter(tree, new Date(), { relativeDates: true })
            : null;
        if (!json) return null;
        try {
            const parsed: unknown = JSON.parse(json);
            return parsed &&
                typeof parsed === 'object' &&
                !Array.isArray(parsed)
                ? (parsed as Record<string, unknown>)
                : null;
        } catch {
            return null;
        }
    }, [tree]);

    // A stable identity for "these conditions", so the count below re-runs when
    // they actually change and not on every render. Serialising is what the
    // save does anyway, so this costs nothing new.
    const filterKey = filterJson ? JSON.stringify(filterJson) : null;

    /**
     * Re-count the matches whenever the committed conditions change.
     *
     * `previewFor` is a ref rather than a dependency so the effect keys on the
     * conditions alone: `preview.mutate` is a new function identity on every
     * render, and depending on it would re-run this on each keystroke in the
     * name field — one request per character, against a query that scans the
     * collection.
     */
    const previewFor = useRef<{
        contentType?: string;
        run: (input: {
            contentType: string;
            filter: Record<string, unknown>;
        }) => void;
    }>({ run: () => undefined });
    previewFor.current = {
        contentType: watchedType || undefined,
        run: preview.mutate
    };

    useEffect(() => {
        const { contentType, run } = previewFor.current;
        if (!contentType || !filterKey) return;
        run({
            contentType,
            filter: JSON.parse(filterKey) as Record<string, unknown>
        });
    }, [filterKey]);

    const pageTitle = intl.formatMessage(
        isCreate ? messages.createTitle : messages.title
    );
    const crumbs = [
        {
            key: 'alarms',
            label: intl.formatMessage(messages.crumbAlarms),
            to: `/workspaces/${workspace.id}/alarms`
        },
        {
            key: 'rule',
            label: isCreate
                ? intl.formatMessage(messages.crumbNew)
                : (rule?.name ?? pageTitle)
        }
    ];

    if (!canRead) {
        return (
            <>
                <PageTopBar icon={BellRing} crumbs={crumbs} />
                <Container>
                    <ContainerHeader title={pageTitle} />
                    <AlarmsNoAccess />
                </Container>
            </>
        );
    }

    // Creating needs no rule, so neither guard below applies: the rules query is
    // disabled in that mode and would otherwise report `isPending` for ever.
    if (!isCreate && rules.isPending) return <AlarmsSkeleton />;

    if (!isCreate && !rule) {
        return (
            <>
                <PageTopBar icon={BellRing} crumbs={crumbs} />
                <Container>
                    <ContainerHeader title={pageTitle} />
                    <Alert>
                        <TriangleAlert aria-hidden="true" />
                        <AlertTitle>
                            {intl.formatMessage(messages.notFoundTitle)}
                        </AlertTitle>
                        <AlertDescription>
                            {intl.formatMessage(messages.notFoundBody)}
                        </AlertDescription>
                    </Alert>
                </Container>
            </>
        );
    }

    // What the rule is stored as, so the page can say whether the conditions on
    // screen have been saved. Compared as serialised JSON rather than by
    // identity — the tree is rebuilt on every commit.
    const savedFilterKey = rule ? JSON.stringify(rule.filter) : null;
    // `?? ''` rather than a null guard: clearing every condition **is** a
    // change, and treating it as "nothing to report" was how the page could
    // differ from the stored rule while claiming to be in step with it. It is
    // the notice below that stays quiet in that case, because the empty-state
    // paragraph and a disabled Save already say something more specific.
    // Nothing is "unsaved" on a rule that does not exist yet — the whole page
    // is unsaved, and the Create button says so.
    const conditionsDirty =
        savedFilterKey !== null && (filterKey ?? '') !== savedFilterKey;
    const ruleCount = countRules(tree);

    const backToList = () => navigate(`/workspaces/${workspace.id}/alarms`);

    const onFailed = (error: unknown) =>
        toast.error(
            intl.formatMessage(messages.saveFailed, {
                reason: (error as Error).message
            })
        );

    const onSave = () => {
        // Never send `undefined` here to mean "leave it alone": with no
        // conditions the Save button is disabled, so reaching this with a null
        // filter is impossible, and silently keeping the previous condition
        // after someone cleared it would be the worst of the options.
        if (!filterJson) return;

        if (isCreate) {
            create.mutate(
                {
                    contentType,
                    name: name.trim(),
                    findingTitle: findingTitle.trim(),
                    description: description.trim(),
                    severity,
                    filter: filterJson
                },
                {
                    onSuccess: (result) => {
                        // The server scans before it answers, so the toast can
                        // report what the alarm actually found rather than
                        // "created" and leaving the author to go and look.
                        toast.success(
                            intl.formatMessage(messages.created, {
                                name: result.rule.name,
                                open: result.scan.open
                            })
                        );
                        backToList();
                    },
                    onError: onFailed
                }
            );
            return;
        }

        if (!rule) return;
        update.mutate(
            {
                id: rule.id,
                input: {
                    name: name.trim(),
                    findingTitle: findingTitle.trim(),
                    description: description.trim(),
                    severity,
                    filter: filterJson
                }
            },
            {
                onSuccess: () => {
                    toast.success(intl.formatMessage(messages.saved));
                    backToList();
                },
                onError: onFailed
            }
        );
    };

    return (
        <>
            <PageTopBar icon={BellRing} crumbs={crumbs} />
            <Container>
                <ContainerHeader
                    title={pageTitle}
                    subtitle={
                        isCreate
                            ? intl.formatMessage(messages.createSubtitle)
                            : intl.formatMessage(messages.subtitle, {
                                  contentType: rule?.contentType ?? ''
                              })
                    }
                />

                <div className="flex max-w-3xl flex-col gap-6">
                    {rule?.brokenReason ? (
                        <Alert variant="destructive">
                            <TriangleAlert aria-hidden="true" />
                            <AlertTitle>
                                {intl.formatMessage(messages.brokenTitle)}
                            </AlertTitle>
                            <AlertDescription>
                                {rule.brokenReason}
                            </AlertDescription>
                        </Alert>
                    ) : null}

                    <div className="flex flex-col gap-4">
                        {/* The convention stated once, in the page, rather than
                            as a `title` on each mark — a `title` is mouse-only,
                            not dismissible, and on an `aria-hidden` element no
                            assistive tech can reach it either. Only rendered
                            where something is actually marked, i.e. for a
                            caller who can edit. */}
                        {canManage ? (
                            <p className="text-xs text-muted-foreground">
                                {intl.formatMessage(messages.requiredLegend)}
                            </p>
                        ) : null}

                        {/* Only while creating. An existing alarm's type is
                            fixed: every finding it holds is a statement about a
                            record of that type, so changing it would not edit
                            the alarm, it would silently repurpose its history. */}
                        {isCreate ? (
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="alarms-editor-type">
                                    {intl.formatMessage(messages.contentType)}
                                    <RequiredMark />
                                </Label>
                                <Select
                                    value={contentType}
                                    disabled={!canManage}
                                    onValueChange={(next) => {
                                        setContentType(next);
                                        // The conditions belong to the old
                                        // type's fields; keeping them would
                                        // offer a builder full of rules the new
                                        // type cannot resolve.
                                        setTree(null);
                                    }}
                                >
                                    <SelectTrigger
                                        id="alarms-editor-type"
                                        aria-required
                                    >
                                        <SelectValue
                                            placeholder={intl.formatMessage(
                                                messages.contentTypePlaceholder
                                            )}
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(types.data ?? [])
                                            .filter(
                                                (type) =>
                                                    type.kind === 'collection'
                                            )
                                            .map((type) => (
                                                <SelectItem
                                                    key={type.name}
                                                    value={type.name}
                                                >
                                                    {type.label}
                                                </SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    {intl.formatMessage(
                                        messages.contentTypeHint
                                    )}
                                </p>
                            </div>
                        ) : null}

                        {/* `label` is wrapped in **one** element, not a
                            fragment: `FieldLabel` is a flex row with a `gap-2`,
                            so two items put 8px between the word and the `*`
                            that belongs to it. */}
                        <InputField
                            id="alarms-editor-name"
                            label={
                                <span>
                                    {intl.formatMessage(messages.name)}
                                    <RequiredMark />
                                </span>
                            }
                            aria-required
                            value={name}
                            disabled={!canManage}
                            onChange={(event) => setName(event.target.value)}
                        />
                        <InputField
                            id="alarms-editor-finding-title"
                            label={
                                <span>
                                    {intl.formatMessage(messages.findingTitle)}
                                    <RequiredMark />
                                </span>
                            }
                            aria-required
                            description={intl.formatMessage(
                                messages.findingHint
                            )}
                            value={findingTitle}
                            disabled={!canManage}
                            onChange={(event) =>
                                setFindingTitle(event.target.value)
                            }
                        />

                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="alarms-editor-description">
                                {intl.formatMessage(messages.description)}
                            </Label>
                            <Textarea
                                id="alarms-editor-description"
                                value={description}
                                disabled={!canManage}
                                onChange={(event) =>
                                    setDescription(event.target.value)
                                }
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="alarms-editor-severity">
                                {intl.formatMessage(messages.severity)}
                            </Label>
                            <Select
                                value={severity}
                                disabled={!canManage}
                                onValueChange={(next) =>
                                    setSeverity(next as AlarmSeverity)
                                }
                            >
                                <SelectTrigger id="alarms-editor-severity">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {ALARM_SEVERITIES.map((value) => (
                                        <SelectItem key={value} value={value}>
                                            {intl.formatMessage(
                                                SEVERITY_LABELS[value]
                                            )}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* The conditions read as their own panel rather than as
                        one more form row: they are what the rule *is*, and the
                        three fields above are how it is worded. */}
                    <section className="flex flex-col gap-4 rounded-xl border bg-card p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="flex flex-col gap-1">
                                <h2 className="text-sm font-medium">
                                    {intl.formatMessage(messages.condition)}
                                </h2>
                                <p className="max-w-prose text-xs text-muted-foreground">
                                    {intl.formatMessage(messages.conditionHint)}
                                </p>
                            </div>
                            <Button
                                id="alarms-editor-condition-toggle"
                                variant="outline"
                                size="sm"
                                className="shrink-0"
                                disabled={!canManage || !watchedType}
                                aria-expanded={builderOpen}
                                aria-controls="alarms-editor-condition-panel"
                                onClick={() => setBuilderOpen((open) => !open)}
                            >
                                <SlidersHorizontal aria-hidden="true" />
                                {intl.formatMessage(
                                    builderOpen
                                        ? messages.doneEditing
                                        : messages.editCondition
                                )}
                            </Button>
                        </div>

                        {/* The committed conditions, at rest. This is what
                            makes Apply visible: press it and the chips here
                            change. Removing one re-commits immediately, the
                            same as in the records toolbar. */}
                        {!watchedType ? (
                            <p className="text-sm text-muted-foreground">
                                {intl.formatMessage(messages.pickTypeFirst)}
                            </p>
                        ) : tree && ruleCount > 0 ? (
                            <QueryBuilderSummary
                                tree={tree}
                                fields={fields}
                                onChange={setTree}
                            />
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                {intl.formatMessage(messages.noCondition)}
                            </p>
                        )}

                        {/* The load state is threaded through, not dropped.
                            The Apply gate rejects every rule whose field it
                            cannot resolve, so a panel handed an empty `fields`
                            array while the surface is still loading — or after
                            it failed — refuses to commit and says nothing about
                            why. That is the defect that made "Apply" look like
                            a dead button and let an edited condition be saved
                            as the old one. */}
                        <QueryBuilderPanel
                            id="alarms-editor-condition-panel"
                            open={builderOpen}
                            onOpenChange={setBuilderOpen}
                            fields={fields}
                            fieldsPending={
                                filterFields.isPending ||
                                // A disabled query is `isPending` forever, so
                                // this has to be gated on there being a type at
                                // all — otherwise the builder claims to be
                                // loading on a page where nothing was asked for.
                                (Boolean(watchedType) && schema.isPending)
                            }
                            fieldsError={filterFields.isError}
                            onRetryFields={filterFields.refetch}
                            value={tree}
                            onApply={setTree}
                            // The panel stays open after Apply by default,
                            // which is right for the records list — the table
                            // underneath is what changed, and it is still on
                            // screen. Here Apply commits into the chips *above*
                            // the builder, so leaving it expanded hides the one
                            // thing that just moved.
                            //
                            // Focus has to come back with it: collapsing makes
                            // the region `inert`, so a focus still inside it
                            // drops to `<body>` and the next Tab restarts at
                            // the top of the document. The toggle is where the
                            // gesture started and where Esc already returns to.
                            onApplied={() => {
                                setBuilderOpen(false);
                                requestAnimationFrame(() =>
                                    document
                                        .getElementById(
                                            'alarms-editor-condition-toggle'
                                        )
                                        ?.focus()
                                );
                            }}
                            // Without this a relation rule's value cell is a
                            // plain text box: the query builder deliberately
                            // holds no data layer, so the record picker is
                            // injected by whoever mounts it. The records list
                            // passes it and this did not, which is why picking
                            // a related record worked in the table and not
                            // here — the same class of omission as the field
                            // surface above.
                            renderRelationValue={(props) => (
                                <RelationValuePicker {...props} />
                            )}
                            labelledBy="alarms-editor-condition-toggle"
                        />

                        {/* One line, three states, always present once there is
                            something to count — the number that says whether
                            the rule means what its author thinks. */}
                        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
                            <p
                                className="text-sm text-muted-foreground"
                                aria-live="polite"
                            >
                                {!filterJson
                                    ? null
                                    : preview.isPending
                                      ? intl.formatMessage(messages.matching)
                                      : preview.isError
                                        ? intl.formatMessage(
                                              messages.matchFailed,
                                              {
                                                  reason: (
                                                      preview.error as Error
                                                  ).message
                                              }
                                          )
                                        : preview.data
                                          ? `${intl.formatMessage(
                                                messages.matches,
                                                {
                                                    matched:
                                                        preview.data.matched,
                                                    total: preview.data.total
                                                }
                                            )}${
                                                preview.data.total > 0 &&
                                                preview.data.matched ===
                                                    preview.data.total
                                                    ? ` ${intl.formatMessage(messages.matchesEverything)}`
                                                    : ''
                                            }`
                                          : null}
                            </p>
                            {filterJson ? (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="ml-auto"
                                    disabled={preview.isPending}
                                    onClick={() =>
                                        preview.mutate({
                                            contentType: watchedType,
                                            filter: filterJson
                                        })
                                    }
                                >
                                    {preview.isPending ? <Spinner /> : null}
                                    {intl.formatMessage(messages.recount)}
                                </Button>
                            ) : null}
                        </div>
                    </section>

                    {conditionsDirty && filterJson ? (
                        // The icon is **inside** the description rather than a
                        // top-level child of `Alert`. `Alert` absolutely
                        // positions a top-level `<svg>` at `left-4 top-4` and
                        // nudges the block beside it up 3px — geometry tuned
                        // for a title over a description. This banner is a
                        // description alone, one line long, so those rules put
                        // the icon near the top of the box and the sentence off
                        // its centre. Wrapping both in a flex row means none of
                        // the `[&>svg]` selectors match, which fixes it here
                        // without touching the geometry the admin's other
                        // ~25 alerts are drawn with.
                        <Alert variant="warning">
                            <AlertDescription className="flex items-center gap-2">
                                <TriangleAlert
                                    aria-hidden="true"
                                    className="size-4 shrink-0 text-warning"
                                />
                                {intl.formatMessage(messages.unsaved)}
                            </AlertDescription>
                        </Alert>
                    ) : null}

                    {canManage ? (
                        <div className="flex items-center gap-2">
                            <Button
                                disabled={
                                    update.isPending ||
                                    create.isPending ||
                                    !filterJson ||
                                    (isCreate && !contentType) ||
                                    name.trim().length === 0 ||
                                    findingTitle.trim().length === 0
                                }
                                onClick={onSave}
                            >
                                {update.isPending || create.isPending ? (
                                    <Spinner />
                                ) : null}
                                {intl.formatMessage(
                                    isCreate ? messages.create : messages.save
                                )}
                            </Button>
                            <Button variant="ghost" onClick={backToList}>
                                {intl.formatMessage(messages.cancel)}
                            </Button>
                        </div>
                    ) : null}
                </div>
            </Container>
        </>
    );
}
