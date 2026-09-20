import { useMemo, useState, type ComponentType } from 'react';
import { useIntl, type MessageDescriptor } from 'react-intl';
import {
    Checkbox,
    cn,
    InputGroup,
    InputGroupAddon,
    InputGroupInput
} from '@orthacms/design-system';
import { Search } from 'lucide-react';
import { useResourceSelection } from '../../../../hooks/useResourceSelection';
import type { ResourceSelection } from '../../../../../domain/types/wizard';

/** A selectable row in a {@link ResourceSection}. */
export type ResourceRow = {
    /** Stable id (the content type name). */
    id: string;
    /** Primary label. */
    primary: string;
    /** Secondary line (description or path), also searched. */
    secondary?: string;
};

/** The i18n strings a {@link ResourceSection} needs. */
export type ResourceSectionMessages = {
    heading: MessageDescriptor;
    help: MessageDescriptor;
    searchPlaceholder: MessageDescriptor;
    allLabel: MessageDescriptor;
    empty: MessageDescriptor;
    noResults: MessageDescriptor;
    /** Plural — receives `{count}`. */
    countSpecific: MessageDescriptor;
    countAll: MessageDescriptor;
    /** Plural — receives `{count}` excluded. */
    countAllExcluded: MessageDescriptor;
};

/** Props for {@link ResourceSection}. */
export type ResourceSectionProps = {
    /** Section copy. */
    messages: ResourceSectionMessages;
    /** Leading icon for every row. */
    icon: ComponentType<{ className?: string }>;
    /** All rows (filtering affects only what's rendered). */
    rows: ResourceRow[];
    /** Current selection. */
    selection: ResourceSelection;
    /** Replace the selection. */
    onChange: (next: ResourceSelection) => void;
};

/**
 * A generic "specific vs all" selection panel — used for both collections and
 * pages. Owns local search; the caller owns the selection state and supplies
 * rows, icon, and copy.
 */
export function ResourceSection({
    messages,
    icon: Icon,
    rows,
    selection,
    onChange
}: ResourceSectionProps) {
    const intl = useIntl();
    const [search, setSearch] = useState('');
    const controller = useResourceSelection(selection, onChange, rows.length);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter((row) =>
            `${row.primary} ${row.secondary ?? ''}`.toLowerCase().includes(q)
        );
    }, [rows, search]);

    const countLabel =
        selection.mode === 'all'
            ? selection.excludedIds.length === 0
                ? intl.formatMessage(messages.countAll)
                : intl.formatMessage(messages.countAllExcluded, {
                      count: selection.excludedIds.length
                  })
            : intl.formatMessage(messages.countSpecific, {
                  count: controller.count
              });

    return (
        <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
                <h3 className="text-sm font-medium">
                    {intl.formatMessage(messages.heading)}
                </h3>
                <p className="text-sm text-muted-foreground">
                    {intl.formatMessage(messages.help)}
                </p>
            </div>

            <label className="flex items-center gap-3 rounded-lg border px-3 py-2">
                <Checkbox
                    checked={controller.isAll}
                    onCheckedChange={(checked) =>
                        controller.setAll(checked === true)
                    }
                />
                <span className="text-sm font-medium">
                    {intl.formatMessage(messages.allLabel)}
                </span>
            </label>

            <InputGroup className="shadow-none">
                <InputGroupAddon>
                    <Search />
                </InputGroupAddon>
                <InputGroupInput
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={intl.formatMessage(messages.searchPlaceholder)}
                    aria-label={intl.formatMessage(messages.searchPlaceholder)}
                />
            </InputGroup>

            {rows.length === 0 ? (
                <p className="px-1 py-2 text-sm text-muted-foreground">
                    {intl.formatMessage(messages.empty)}
                </p>
            ) : filtered.length === 0 ? (
                <p className="px-1 py-2 text-sm text-muted-foreground">
                    {intl.formatMessage(messages.noResults)}
                </p>
            ) : (
                <ul className="flex flex-col rounded-lg border">
                    {filtered.map((row, index) => (
                        <li key={row.id}>
                            <label
                                className={cn(
                                    'flex cursor-pointer items-center gap-3 px-3 py-2',
                                    index > 0 && 'border-t'
                                )}
                            >
                                <Checkbox
                                    checked={controller.isSelected(row.id)}
                                    onCheckedChange={() =>
                                        controller.toggle(row.id)
                                    }
                                />
                                <Icon className="size-4 shrink-0 text-muted-foreground" />
                                <span className="flex min-w-0 flex-col">
                                    <span className="truncate text-sm font-medium">
                                        {row.primary}
                                    </span>
                                    {row.secondary ? (
                                        <span className="truncate text-xs text-muted-foreground">
                                            {row.secondary}
                                        </span>
                                    ) : null}
                                </span>
                            </label>
                        </li>
                    ))}
                </ul>
            )}

            <p className="text-xs text-muted-foreground">{countLabel}</p>
        </section>
    );
}
