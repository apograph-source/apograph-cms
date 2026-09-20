import { defineMessages, useIntl } from 'react-intl';
import {
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@orthacms/design-system';
import {
    FIELD_TYPE,
    type FieldType,
    type FilterField,
    type RelationValueEditor
} from '../../../../../types/filter-field.type';
import {
    MAX_WITHIN_LAST,
    OP,
    WITHIN_UNIT,
    type OpId,
    type RuleValue,
    type WithinUnit
} from '../../../../../types/filter-tree.type';
import {
    isoToLocalInput,
    localInputToIso
} from '../../../../../utils/dateInput';
import { CsvValueInput } from './CsvValueInput';
import { EnumMultiSelect } from './EnumMultiSelect';

const messages = defineMessages({
    rangeJoin: { id: 'qb.value.rangeJoin', defaultMessage: 'and' },
    value: { id: 'qb.value.label', defaultMessage: 'Value' },
    rangeFrom: { id: 'qb.value.rangeFrom', defaultMessage: 'From' },
    rangeTo: { id: 'qb.value.rangeTo', defaultMessage: 'To' },
    withinAmount: { id: 'qb.value.withinAmount', defaultMessage: 'Amount' },
    withinUnit: { id: 'qb.value.withinUnit', defaultMessage: 'Unit' },
    selectPlaceholder: {
        id: 'qb.value.selectPlaceholder',
        defaultMessage: 'Select…'
    },
    booleanTrue: { id: 'qb.value.booleanTrue', defaultMessage: 'true' },
    booleanFalse: { id: 'qb.value.booleanFalse', defaultMessage: 'false' },
    csvPlaceholder: {
        id: 'qb.value.csvPlaceholder',
        defaultMessage: 'value1,value2'
    },
    minutes: { id: 'qb.value.minutes', defaultMessage: 'minutes' },
    hours: { id: 'qb.value.hours', defaultMessage: 'hours' },
    days: { id: 'qb.value.days', defaultMessage: 'days' }
});

const WITHIN_UNIT_LABELS: Record<WithinUnit, typeof messages.minutes> = {
    [WITHIN_UNIT.Minutes]: messages.minutes,
    [WITHIN_UNIT.Hours]: messages.hours,
    [WITHIN_UNIT.Days]: messages.days
};

/** Props for {@link ValueEditor}. */
export type ValueEditorProps = {
    field: FilterField;
    op: OpId;
    value: RuleValue;
    onChange: (next: RuleValue) => void;
    /** Marks the control(s) `aria-invalid` when the rule fails validation. */
    invalid?: boolean;
    /** Id of the rule's error message, wired as `aria-describedby`. */
    describedById?: string;
    /** Record picker for a relation-id field; falls back to uuid text input. */
    renderRelationValue?: RelationValueEditor;
};

const inputTypeFor = (
    fieldType: FieldType
): 'datetime-local' | 'number' | 'text' => {
    if (fieldType === FIELD_TYPE.Date) return 'datetime-local';
    if (fieldType === FIELD_TYPE.Number) return 'number';
    return 'text';
};

/**
 * Date fields store a full ISO instant on the wire but `datetime-local` reads
 * `YYYY-MM-DDTHH:mm` — convert in/out so the column's `timestamptz` semantics
 * stay exact. Non-date fields pass their string value through untouched.
 */
const toInputValue = (fieldType: FieldType, v: string): string =>
    fieldType === FIELD_TYPE.Date ? isoToLocalInput(v) : v;
const fromInputValue = (fieldType: FieldType, v: string): string =>
    fieldType === FIELD_TYPE.Date ? localInputToIso(v) : v;

/**
 * Switch-based value editor: picks the right control for the active
 * field/op pair. `is_empty` renders nothing — the operator carries the
 * full meaning. `between` and `within_last` render compound editors. For
 * `is_one_of`, an enum field gets a constrained checkbox multi-select
 * ({@link EnumMultiSelect}); string/uuid fields keep a comma-separated
 * text input. Date fields use `datetime-local` over a full ISO instant so
 * `timestamptz` comparisons stay exact.
 */
export function ValueEditor({
    field,
    op,
    value,
    onChange,
    invalid,
    describedById,
    renderRelationValue
}: ValueEditorProps) {
    const intl = useIntl();
    // Shared a11y props applied to every editor variant's primary control,
    // so a failed Apply marks the value invalid and points screen readers
    // at the rule's error text.
    const a11y = {
        'aria-invalid': invalid || undefined,
        'aria-describedby': describedById
    };

    if (op === OP.IsEmpty || op === OP.IsNotEmpty) return null;

    const isMulti = op === OP.IsOneOf || op === OP.NotOneOf;

    // A relation id is a uuid to the engine, but a RECORD to the user. When
    // the consumer supplies a picker, the set-membership / equality ops route
    // to it; comparison ops (gt/lt/…) are meaningless on a uuid and never
    // reach a relation field anyway (its ops list excludes them).
    if (
        field.relationTarget &&
        renderRelationValue &&
        (isMulti || op === OP.Equals || op === OP.NotEquals)
    ) {
        const ids = Array.isArray(value)
            ? value
            : typeof value === 'string' && value
              ? [value]
              : [];
        return renderRelationValue({
            target: field.relationTarget,
            value: ids,
            onChange: (next) => onChange(isMulti ? next : (next[0] ?? '')),
            invalid,
            describedById
        });
    }

    if (op === OP.Between) {
        const range = (value as { from: string; to: string }) ?? {
            from: '',
            to: ''
        };
        const inputType = inputTypeFor(field.type);
        return (
            <div className="flex w-full items-center gap-1">
                <Input
                    type={inputType}
                    value={toInputValue(field.type, range.from)}
                    onChange={(e) =>
                        onChange({
                            ...range,
                            from: fromInputValue(field.type, e.target.value)
                        })
                    }
                    aria-label={intl.formatMessage(messages.rangeFrom)}
                    className="min-w-0 flex-1"
                    {...a11y}
                />
                <span className="text-muted-foreground shrink-0 text-xs">
                    {intl.formatMessage(messages.rangeJoin)}
                </span>
                <Input
                    type={inputType}
                    value={toInputValue(field.type, range.to)}
                    onChange={(e) =>
                        onChange({
                            ...range,
                            to: fromInputValue(field.type, e.target.value)
                        })
                    }
                    aria-label={intl.formatMessage(messages.rangeTo)}
                    className="min-w-0 flex-1"
                    {...a11y}
                />
            </div>
        );
    }

    if (op === OP.WithinLast) {
        const v = (value as { n: number; unit: WithinUnit }) ?? {
            n: 7,
            unit: WITHIN_UNIT.Days
        };
        return (
            <div className="flex w-full items-center gap-1">
                <Input
                    type="number"
                    min={1}
                    max={MAX_WITHIN_LAST}
                    value={String(v.n)}
                    onChange={(e) =>
                        onChange({
                            ...v,
                            // Clamped at both ends. The upper bound matters as
                            // much as the lower one: the JSON preview
                            // serialises the draft on every keystroke, so a
                            // half-typed long number used to resolve to an
                            // instant `Date` cannot represent and threw
                            // mid-edit.
                            n: Math.min(
                                MAX_WITHIN_LAST,
                                Math.max(1, Number(e.target.value) || 1)
                            )
                        })
                    }
                    aria-label={intl.formatMessage(messages.withinAmount)}
                    className="w-20 shrink-0"
                    {...a11y}
                />
                <Select
                    value={v.unit}
                    onValueChange={(unit) =>
                        onChange({ ...v, unit: unit as WithinUnit })
                    }
                >
                    <SelectTrigger
                        className="min-w-0 flex-1"
                        aria-label={intl.formatMessage(messages.withinUnit)}
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {Object.values(WITHIN_UNIT).map((unit) => (
                            <SelectItem key={unit} value={unit}>
                                {intl.formatMessage(WITHIN_UNIT_LABELS[unit])}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        );
    }

    if (field.type === FIELD_TYPE.Enum && field.enumValues) {
        if (isMulti) {
            // Constrain `is_one_of` / `is none of` on an enum to its declared
            // members so a value can't be typed that the server would reject
            // with FILTER_INVALID_VALUE. (Free-text CSV stays for string/uuid.)
            return (
                <EnumMultiSelect
                    options={field.enumValues}
                    value={Array.isArray(value) ? value : []}
                    onChange={onChange}
                    label={intl.formatMessage(messages.value)}
                    invalid={invalid}
                    describedById={describedById}
                />
            );
        }
        return (
            <Select
                value={typeof value === 'string' ? value : ''}
                onValueChange={(v) => onChange(v)}
            >
                <SelectTrigger
                    className="w-full"
                    aria-label={intl.formatMessage(messages.value)}
                    {...a11y}
                >
                    <SelectValue
                        placeholder={intl.formatMessage(
                            messages.selectPlaceholder
                        )}
                    />
                </SelectTrigger>
                <SelectContent>
                    {field.enumValues.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                            {intl.formatMessage(opt.label)}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        );
    }

    if (isMulti) {
        return (
            <CsvValueInput
                value={Array.isArray(value) ? value : []}
                onChange={onChange}
                placeholder={intl.formatMessage(messages.csvPlaceholder)}
                ariaLabel={intl.formatMessage(messages.value)}
                className="w-full"
                invalid={invalid}
                describedById={describedById}
            />
        );
    }

    if (field.type === FIELD_TYPE.Boolean) {
        return (
            <Select
                value={typeof value === 'string' ? value : ''}
                onValueChange={(v) => onChange(v)}
            >
                <SelectTrigger
                    className="w-full"
                    aria-label={intl.formatMessage(messages.value)}
                    {...a11y}
                >
                    <SelectValue
                        placeholder={intl.formatMessage(
                            messages.selectPlaceholder
                        )}
                    />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="true">
                        {intl.formatMessage(messages.booleanTrue)}
                    </SelectItem>
                    <SelectItem value="false">
                        {intl.formatMessage(messages.booleanFalse)}
                    </SelectItem>
                </SelectContent>
            </Select>
        );
    }

    return (
        <Input
            type={inputTypeFor(field.type)}
            value={toInputValue(
                field.type,
                typeof value === 'string' ? value : ''
            )}
            onChange={(e) =>
                onChange(fromInputValue(field.type, e.target.value))
            }
            aria-label={intl.formatMessage(messages.value)}
            className="w-full"
            {...a11y}
        />
    );
}
