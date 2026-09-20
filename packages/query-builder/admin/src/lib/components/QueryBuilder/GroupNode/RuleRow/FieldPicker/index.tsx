import {
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent
} from 'react';
import { defineMessages, useIntl, type MessageDescriptor } from 'react-intl';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import {
    Button,
    Input,
    Popover,
    PopoverContent,
    PopoverTrigger,
    cn
} from '@orthacms/design-system';
import {
    FIELD_TYPE,
    type FieldType,
    type FilterField
} from '../../../../../types/filter-field.type';
import {
    buildFieldTree,
    type RelationNode
} from '../../../../../utils/fieldTree';
import { usePortalContainer } from '../../../../portalContainer';

const messages = defineMessages({
    label: { id: 'qb.field.label', defaultMessage: 'Field' },
    placeholder: { id: 'qb.field.placeholder', defaultMessage: 'Field' },
    search: {
        id: 'qb.field.search',
        defaultMessage: 'Search fields and relations'
    },
    empty: { id: 'qb.field.empty', defaultMessage: 'No matching field.' },
    fieldsGroup: { id: 'qb.field.group.fields', defaultMessage: 'Fields' },
    relationsGroup: {
        id: 'qb.field.group.relations',
        defaultMessage: 'Relations'
    },
    relationFields: {
        id: 'qb.field.relationFields',
        defaultMessage: '{name} fields'
    },
    expand: { id: 'qb.field.expand', defaultMessage: 'Expand {name}' },
    collapse: { id: 'qb.field.collapse', defaultMessage: 'Collapse {name}' }
});

const typeTags = defineMessages({
    text: { id: 'qb.field.type.text', defaultMessage: 'text' },
    number: { id: 'qb.field.type.number', defaultMessage: 'number' },
    boolean: { id: 'qb.field.type.boolean', defaultMessage: 'boolean' },
    date: { id: 'qb.field.type.date', defaultMessage: 'date' },
    enum: { id: 'qb.field.type.enum', defaultMessage: 'enum' },
    relation: { id: 'qb.field.type.relation', defaultMessage: 'relation' }
});

/** Props for {@link FieldPicker}. */
export type FieldPickerProps = {
    fields: readonly FilterField[];
    value: string;
    onChange: (next: string) => void;
    /**
     * Accessible name for the trigger, scoped to the rule this picker belongs to
     * — e.g. "Field for Author · Name". Defaults to a bare "Field", which is what
     * every row on screen used to be called (`ORT-157`). The popover's listbox
     * keeps the generic name: once it is open there is only one of them.
     */
    label?: string;
};

/** The type tag shown beside a field — a relation `id` reads as "relation". */
function typeTagFor(field: FilterField): MessageDescriptor {
    if (field.relationTarget) return typeTags.relation;
    const byType: Record<FieldType, MessageDescriptor> = {
        [FIELD_TYPE.String]: typeTags.text,
        [FIELD_TYPE.Number]: typeTags.number,
        [FIELD_TYPE.Boolean]: typeTags.boolean,
        [FIELD_TYPE.Date]: typeTags.date,
        [FIELD_TYPE.Enum]: typeTags.enum,
        [FIELD_TYPE.Uuid]: typeTags.relation
    };
    return byType[field.type];
}

/** Whitespace-tokenised match: every token of `query` must appear in `haystack`. */
function matchesQuery(haystack: string, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return q.split(/\s+/).every((token) => haystack.includes(token));
}

/** A rendered row — the union the list maps over and the keyboard walks. */
type Row =
    | { kind: 'header'; key: string; label: MessageDescriptor }
    | {
          kind: 'subheader';
          key: string;
          label: MessageDescriptor;
          depth: number;
      }
    | { kind: 'relation'; key: string; node: RelationNode; depth: number }
    | {
          kind: 'field';
          key: string;
          field: FilterField;
          depth: number;
          crumbs: readonly MessageDescriptor[];
      };

const isNavigable = (row: Row): boolean =>
    row.kind === 'field' || row.kind === 'relation';

/**
 * Relation-aware field selector.
 *
 * **Resting state**: the selected field as a compact path of chips — relation
 * segments as neutral chips, the leaf as a solid chip ("Author · Email") — or a
 * muted "Field" placeholder with a chevron. Clicking (or Enter) opens the
 * picker.
 *
 * **Picker**: a pinned search over the collection's fields *and* every reachable
 * relation field, flattened while searching. Idle, it shows "Fields" (the
 * collection's own scalars, first) then "Relations" (collapsed; expanding one
 * reveals its fields under a "<Relation> fields" sub-header plus its own nested
 * relations, recursively). Each field carries a small type tag. Arrow keys move,
 * Enter selects a field or toggles a relation, Esc closes.
 *
 * Structural notes kept from the prior picker: a padded `Popover` + a plain
 * `Input` over one `overflow-y-auto` list (so the wheel scrolls and the border
 * stays clean), the trigger is `role="combobox"` and field rows `role="option"`,
 * and the content portals into {@link usePortalContainer} so it scrolls inside
 * the filter drawer / dialog.
 *
 * **Accessibility.** The list is a real `listbox`: every *navigable* row is an
 * `option` (a relation row too — it carries `aria-expanded` rather than a
 * value), and the group headings are `presentation` so they don't sit in the
 * listbox as invalid children. Focus stays on the search box, which drives the
 * list via `aria-controls` + `aria-activedescendant` — without that the arrow
 * keys would move a highlight that assistive tech never hears about. Rows are
 * `tabIndex={-1}` so Tab leaves the popover instead of walking every field.
 */
export function FieldPicker({
    fields,
    value,
    onChange,
    label
}: FieldPickerProps) {
    const intl = useIntl();
    const container = usePortalContainer();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
    const [activeIndex, setActiveIndex] = useState(0);
    const rowRefs = useRef(new Map<number, HTMLElement>());
    const listId = useId();
    const rowId = (index: number) => `${listId}-row-${index}`;

    const tree = useMemo(() => buildFieldTree(fields), [fields]);
    const searching = query.trim().length > 0;

    const rows = useMemo<Row[]>(() => {
        const out: Row[] = [];
        if (searching) {
            for (const field of fields) {
                const crumbs = field.group ?? [];
                const haystack = `${crumbs
                    .map((c) => intl.formatMessage(c))
                    .join(
                        ' '
                    )} ${intl.formatMessage(field.label)} ${field.id}`.toLowerCase();
                if (matchesQuery(haystack, query)) {
                    out.push({
                        kind: 'field',
                        key: field.id,
                        field,
                        depth: 0,
                        crumbs
                    });
                }
            }
            return out;
        }

        if (tree.fields.length > 0) {
            out.push({
                kind: 'header',
                key: 'h:fields',
                label: messages.fieldsGroup
            });
            for (const field of tree.fields) {
                out.push({
                    kind: 'field',
                    key: field.id,
                    field,
                    depth: 0,
                    crumbs: []
                });
            }
        }
        // Named buckets of the collection's own fields (a plugin's virtual
        // fields), between its scalars and its relations: they are the
        // collection's, so they sit above Relations, but they are not what a
        // reader scanning for a column of their type is looking for, so they
        // sit below Fields.
        for (const category of tree.categories) {
            if (category.fields.length === 0) continue;
            out.push({
                kind: 'header',
                key: `h:c:${category.key}`,
                label: category.label
            });
            for (const field of category.fields) {
                out.push({
                    kind: 'field',
                    key: field.id,
                    field,
                    depth: 0,
                    crumbs: []
                });
            }
        }

        if (tree.relations.length > 0) {
            out.push({
                kind: 'header',
                key: 'h:relations',
                label: messages.relationsGroup
            });
            const pushRelation = (node: RelationNode, depth: number) => {
                out.push({ kind: 'relation', key: node.key, node, depth });
                if (!expanded.has(node.key)) return;
                out.push({
                    kind: 'subheader',
                    key: `${node.key}:fields`,
                    label: node.label,
                    depth: depth + 1
                });
                for (const field of node.fields) {
                    out.push({
                        kind: 'field',
                        key: field.id,
                        field,
                        depth: depth + 1,
                        crumbs: []
                    });
                }
                for (const child of node.relations) {
                    pushRelation(child, depth + 1);
                }
            };
            for (const relation of tree.relations) pushRelation(relation, 0);
        }
        return out;
    }, [fields, tree, expanded, searching, query, intl]);

    // Reset the highlight to the first navigable row when the picker opens or
    // the search changes — deliberately NOT when a relation expands. Keying on
    // `rows` would fire on every expand and yank the highlight (and the scroll,
    // via the effect below) back to the top; keying on `open`/`query` leaves an
    // expand in place.
    useEffect(() => {
        const first = rows.findIndex(isNavigable);
        setActiveIndex(first === -1 ? 0 : first);
    }, [open, query]);

    // Keep the active row in view as the user arrows through it. Because
    // expanding a relation leaves `activeIndex` untouched, this never fires on
    // expand — so pressing a relation no longer scrolls the list to the top.
    useEffect(() => {
        rowRefs.current.get(activeIndex)?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    const selected = fields.find((f) => f.id === value);
    const selectedCrumbs = (selected?.group ?? []).map((g) =>
        intl.formatMessage(g)
    );

    const commit = (id: string) => {
        onChange(id);
        setOpen(false);
        setQuery('');
    };
    const toggleRelation = (key: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    const step = (delta: number) => {
        setActiveIndex((current) => {
            let i = current;
            for (let n = 0; n < rows.length; n++) {
                i = (i + delta + rows.length) % rows.length;
                if (isNavigable(rows[i])) return i;
            }
            return current;
        });
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            step(1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            step(-1);
        } else if (event.key === 'Enter') {
            const row = rows[activeIndex];
            if (!row) return;
            if (row.kind === 'field') {
                event.preventDefault();
                commit(row.field.id);
            } else if (row.kind === 'relation') {
                event.preventDefault();
                toggleRelation(row.key);
            }
        } else if (event.key === 'Escape') {
            setOpen(false);
        }
    };

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                if (!next) setQuery('');
            }}
        >
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    aria-label={label ?? intl.formatMessage(messages.label)}
                    className="w-full justify-between gap-1 px-2 font-normal"
                >
                    {selected ? (
                        <span
                            className="flex min-w-0 items-center gap-1 overflow-hidden"
                            title={[
                                ...selectedCrumbs,
                                intl.formatMessage(selected.label)
                            ].join(' · ')}
                        >
                            {selectedCrumbs.map((crumb, i) => (
                                <span
                                    key={i}
                                    className="flex shrink-0 items-center gap-1"
                                >
                                    <span className="max-w-[6rem] truncate rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                                        {crumb}
                                    </span>
                                    <span
                                        aria-hidden
                                        className="text-muted-foreground"
                                    >
                                        ·
                                    </span>
                                </span>
                            ))}
                            <span className="truncate rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
                                {intl.formatMessage(selected.label)}
                            </span>
                        </span>
                    ) : (
                        <span className="text-muted-foreground">
                            {intl.formatMessage(messages.placeholder)}
                        </span>
                    )}
                    <ChevronDown className="ml-1 size-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="w-80 p-2"
                container={container}
                onKeyDown={onKeyDown}
            >
                <Input
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={intl.formatMessage(messages.search)}
                    aria-label={intl.formatMessage(messages.search)}
                    // Focus never leaves this box, so it is what announces the
                    // arrow-key highlight. Without `aria-activedescendant` the
                    // active row is a purely visual state.
                    aria-controls={listId}
                    aria-activedescendant={
                        rows[activeIndex] && isNavigable(rows[activeIndex])
                            ? rowId(activeIndex)
                            : undefined
                    }
                    className="mb-1 h-8 rounded-lg shadow-none"
                />
                <div
                    id={listId}
                    role="listbox"
                    aria-label={intl.formatMessage(messages.label)}
                    className="max-h-72 overflow-y-auto"
                >
                    {rows.length === 0 ? (
                        <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                            {intl.formatMessage(messages.empty)}
                        </p>
                    ) : (
                        rows.map((row, index) => {
                            const active = index === activeIndex;
                            const setRef = (el: HTMLElement | null) => {
                                if (el) rowRefs.current.set(index, el);
                                else rowRefs.current.delete(index);
                            };
                            // Base 8px (px-2) + 12px per relation depth. Applied
                            // as padding so the whole row highlights full-width.
                            const depth = row.kind === 'header' ? 0 : row.depth;
                            const indent = { paddingLeft: 8 + depth * 12 };

                            // Headings are `presentation`: a listbox may only
                            // contain `option`/`group` children, so leaving
                            // them as plain text would put invalid nodes in
                            // the accessibility tree.
                            if (row.kind === 'header') {
                                return (
                                    <p
                                        key={row.key}
                                        role="presentation"
                                        className="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                                    >
                                        {intl.formatMessage(row.label)}
                                    </p>
                                );
                            }
                            if (row.kind === 'subheader') {
                                return (
                                    <p
                                        key={row.key}
                                        role="presentation"
                                        style={indent}
                                        className="px-2 py-1 text-xs text-muted-foreground"
                                    >
                                        {intl.formatMessage(
                                            messages.relationFields,
                                            {
                                                name: intl.formatMessage(
                                                    row.label
                                                )
                                            }
                                        )}
                                    </p>
                                );
                            }
                            if (row.kind === 'relation') {
                                const isOpen = expanded.has(row.key);
                                const name = intl.formatMessage(row.node.label);
                                return (
                                    <button
                                        key={row.key}
                                        id={rowId(index)}
                                        ref={setRef}
                                        type="button"
                                        tabIndex={-1}
                                        // A relation row is an `option` too —
                                        // the listbox admits no other
                                        // interactive child — distinguished
                                        // from a value row by `aria-expanded`
                                        // and by never being `aria-selected`.
                                        role="option"
                                        aria-selected={false}
                                        style={indent}
                                        aria-expanded={isOpen}
                                        aria-label={intl.formatMessage(
                                            isOpen
                                                ? messages.collapse
                                                : messages.expand,
                                            { name }
                                        )}
                                        onMouseEnter={() =>
                                            setActiveIndex(index)
                                        }
                                        onClick={() => toggleRelation(row.key)}
                                        className={cn(
                                            'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm',
                                            active &&
                                                'bg-accent text-accent-foreground'
                                        )}
                                    >
                                        {isOpen ? (
                                            <ChevronDown
                                                aria-hidden
                                                className="size-4 shrink-0 text-muted-foreground"
                                            />
                                        ) : (
                                            <ChevronRight
                                                aria-hidden
                                                className="size-4 shrink-0 text-muted-foreground"
                                            />
                                        )}
                                        <span className="truncate">{name}</span>
                                    </button>
                                );
                            }
                            // field
                            const isSelected = row.field.id === value;
                            const crumbs = row.crumbs.map((c) =>
                                intl.formatMessage(c)
                            );
                            return (
                                <button
                                    key={row.key}
                                    id={rowId(index)}
                                    ref={setRef}
                                    type="button"
                                    tabIndex={-1}
                                    role="option"
                                    aria-selected={isSelected}
                                    style={indent}
                                    onMouseEnter={() => setActiveIndex(index)}
                                    onClick={() => commit(row.field.id)}
                                    className={cn(
                                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                                        active &&
                                            'bg-accent text-accent-foreground'
                                    )}
                                >
                                    <Check
                                        aria-hidden
                                        className={cn(
                                            'size-4 shrink-0',
                                            isSelected
                                                ? 'opacity-100'
                                                : 'opacity-0'
                                        )}
                                    />
                                    <span className="flex min-w-0 flex-1 items-center gap-1">
                                        {crumbs.map((crumb, i) => (
                                            <span
                                                key={i}
                                                aria-hidden
                                                className="text-xs text-muted-foreground"
                                            >
                                                {crumb} ·
                                            </span>
                                        ))}
                                        <span className="truncate">
                                            {intl.formatMessage(
                                                row.field.label
                                            )}
                                        </span>
                                    </span>
                                    <span
                                        aria-hidden
                                        className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                                    >
                                        {intl.formatMessage(
                                            typeTagFor(row.field)
                                        )}
                                    </span>
                                </button>
                            );
                        })
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
