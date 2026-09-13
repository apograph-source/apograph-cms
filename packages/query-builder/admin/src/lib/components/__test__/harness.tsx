import { useState, type ReactElement } from 'react';
import { IntlProvider, defineMessages } from 'react-intl';
import { act, render } from '@testing-library/react';
import { FIELD_TYPE, type FilterField } from '../../types/filter-field.type';
import {
    COMBINATOR,
    type FilterGroup,
    type FilterRule,
    type OpId,
    type RuleValue
} from '../../types/filter-tree.type';
import { OP } from '../../types/filter-tree.type';
import { QueryBuilder, type QueryBuilderProps } from '../QueryBuilder';

const labels = defineMessages({
    title: { id: 't.title', defaultMessage: 'Title' },
    views: { id: 't.views', defaultMessage: 'Views' },
    publishedAt: { id: 't.publishedAt', defaultMessage: 'Published at' },
    audience: { id: 't.audience', defaultMessage: 'Can be seen by' },
    segmentation: { id: 't.segmentation', defaultMessage: 'Segmentation' },
    acme: { id: 't.acme', defaultMessage: 'Acme' },
    author: { id: 't.author', defaultMessage: 'Author' },
    authorName: { id: 't.author.name', defaultMessage: 'Name' },
    authorId: { id: 't.author.id', defaultMessage: 'Author record' }
});

/**
 * The schema every builder spec runs against. Deliberately not flat: it has a
 * scalar of each of the three types the value editor draws differently, a
 * *categorised* virtual field whose declared operator list leads with something
 * other than `equals` (so a reset to the first operator is distinguishable from
 * a reset to `equals`), and a relation carrying both a scalar and a
 * `relationTarget` id — the row the injected value editor is rendered for.
 */
export const FIELDS: readonly FilterField[] = [
    { id: 'title', label: labels.title, type: FIELD_TYPE.String },
    { id: 'views', label: labels.views, type: FIELD_TYPE.Number },
    { id: 'publishedAt', label: labels.publishedAt, type: FIELD_TYPE.Date },
    {
        id: 'audience',
        label: labels.audience,
        type: FIELD_TYPE.Enum,
        group: [labels.segmentation],
        operators: [OP.IsOneOf, OP.Equals],
        enumValues: [{ value: 'acme', label: labels.acme }]
    },
    {
        id: 'author.name',
        label: labels.authorName,
        type: FIELD_TYPE.String,
        group: [labels.author]
    },
    {
        id: 'author.id',
        label: labels.authorId,
        type: FIELD_TYPE.Uuid,
        group: [labels.author],
        relationTarget: 'author'
    }
];

/** A leaf with its client-side React key filled in. */
export function rule(
    id: string,
    fieldId: string,
    op: OpId,
    value: RuleValue = ''
): FilterRule {
    return { id, fieldId, op, value };
}

/** A group of the given children; `and` unless told otherwise. */
export function group(
    id: string,
    children: (FilterGroup | FilterRule)[],
    combinator = COMBINATOR.And as FilterGroup['combinator']
): FilterGroup {
    return { id, combinator, children };
}

/** Render anything in the single `IntlProvider` a host would supply. */
export function renderIntl(ui: ReactElement) {
    return render(
        <IntlProvider locale="en" onError={() => undefined}>
            {ui}
        </IntlProvider>
    );
}

/**
 * The builder as a consumer really mounts it: controlled, with the parent
 * holding the tree. Every spec that drives more than one edit needs this —
 * against a frozen `value` the second edit would be computed from the first
 * edit's baseline and the assertion would be about a tree nobody rendered.
 * `onChange` still reports each committed tree so a single edit can be read off
 * the last call.
 */
export function ControlledBuilder({
    initial,
    onChange,
    ...rest
}: {
    initial: FilterGroup | null;
    onChange?: (next: FilterGroup) => void;
} & Omit<QueryBuilderProps, 'value' | 'onChange' | 'fields'> &
    Partial<Pick<QueryBuilderProps, 'fields'>>) {
    const [value, setValue] = useState<FilterGroup | null>(initial);
    return (
        <QueryBuilder
            fields={rest.fields ?? FIELDS}
            {...rest}
            value={value}
            onChange={(next) => {
                setValue(next);
                onChange?.(next);
            }}
        />
    );
}

/**
 * Let one animation frame run. The builder's focus restoration is deliberately
 * deferred to a `requestAnimationFrame` — focusing in the same commit as the
 * unmount is undone by the browser blurring the element that is going away — so
 * a spec that asserts before the frame asserts about `<body>`.
 */
export async function flushFrame(): Promise<void> {
    await act(async () => {
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve())
        );
    });
}
