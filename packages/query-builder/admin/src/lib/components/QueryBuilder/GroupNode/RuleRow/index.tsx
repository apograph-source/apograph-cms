import { useId } from 'react';
import { defineMessages, useIntl, type MessageDescriptor } from 'react-intl';
import { X } from 'lucide-react';
import { Button } from '@orthacms/design-system';
import type {
    FilterField,
    RelationValueEditor
} from '../../../../types/filter-field.type';
import {
    OP,
    type FilterRule,
    type OpId
} from '../../../../types/filter-tree.type';
import { defaultValueForOp } from '../../../../utils/defaultValueForOp';
import { opsForField } from '../../../../utils/operators';
import {
    RULE_VALIDATION,
    validateRule,
    type RuleValidationCode
} from '../../../../utils/validateRule';
import { fieldPath } from '../../../../utils/fieldPath';
import { FieldPicker } from './FieldPicker';
import { OperatorPicker } from './OperatorPicker';
import { ValueEditor } from './ValueEditor';

const messages = defineMessages({
    // Every one of these is scoped to the rule's own field path. Five buttons
    // all called "Remove rule" told a screen-reader user nothing about which
    // one they were on, or which one had gone once they pressed it — 4.1.2 and
    // 2.4.6 (`ORT-157`). `QueryBuilderSummary` already named its chips this
    // way; the builder's own rows did not.
    removeRule: {
        id: 'qb.row.remove',
        defaultMessage: 'Remove condition: {path}'
    },
    fieldFor: {
        id: 'qb.row.fieldFor',
        defaultMessage: 'Field for {path}'
    },
    operatorFor: {
        id: 'qb.row.operatorFor',
        defaultMessage: 'Operator for {path}'
    },
    // 3.3.1 requires the item in error to be identified. A failed Apply
    // inserted three bare `role="alert"` paragraphs at once ("Value required",
    // three times) — which screen readers coalesce or drop, and which named
    // nothing even when they were read.
    errorForField: {
        id: 'qb.row.errorForField',
        defaultMessage: '{path}: {message}'
    }
});

const errorMessages = defineMessages({
    unknown_field: {
        id: 'qb.rule.error.unknownField',
        defaultMessage: 'This field is no longer available — pick another one'
    },
    operator_not_allowed: {
        id: 'qb.rule.error.operatorNotAllowed',
        defaultMessage:
            'This operator does not apply to this field — pick another one'
    },
    value_required: {
        id: 'qb.rule.error.valueRequired',
        defaultMessage: 'Value required'
    },
    not_boolean: {
        id: 'qb.rule.error.notBoolean',
        defaultMessage: 'Must be true or false'
    },
    not_uuid: {
        id: 'qb.rule.error.notUuid',
        defaultMessage: 'Must be a valid UUID'
    },
    not_number: {
        id: 'qb.rule.error.notNumber',
        defaultMessage: 'Must be a number'
    },
    not_date: {
        id: 'qb.rule.error.notDate',
        defaultMessage: 'Must be a valid date'
    },
    range_required: {
        id: 'qb.rule.error.rangeRequired',
        defaultMessage: 'Both bounds required'
    },
    range_invalid: {
        id: 'qb.rule.error.rangeInvalid',
        defaultMessage: 'One of the bounds is invalid for this field'
    },
    multi_required: {
        id: 'qb.rule.error.multiRequired',
        defaultMessage: 'Add at least one value'
    },
    count_required: {
        id: 'qb.rule.error.countRequired',
        defaultMessage: 'Enter a positive count'
    }
});

const ERROR_BY_CODE: Record<RuleValidationCode, MessageDescriptor> = {
    [RULE_VALIDATION.UnknownField]: errorMessages.unknown_field,
    [RULE_VALIDATION.OperatorNotAllowed]: errorMessages.operator_not_allowed,
    [RULE_VALIDATION.ValueRequired]: errorMessages.value_required,
    [RULE_VALIDATION.NotBoolean]: errorMessages.not_boolean,
    [RULE_VALIDATION.NotUuid]: errorMessages.not_uuid,
    [RULE_VALIDATION.NotNumber]: errorMessages.not_number,
    [RULE_VALIDATION.NotDate]: errorMessages.not_date,
    [RULE_VALIDATION.RangeRequired]: errorMessages.range_required,
    [RULE_VALIDATION.RangeInvalid]: errorMessages.range_invalid,
    [RULE_VALIDATION.MultiRequired]: errorMessages.multi_required,
    [RULE_VALIDATION.CountRequired]: errorMessages.count_required
};

/** Props for {@link RuleRow}. */
export type RuleRowProps = {
    rule: FilterRule;
    fields: readonly FilterField[];
    onUpdate: (patch: Partial<FilterRule>) => void;
    onRemove: () => void;
    /** When true, render the inline error message under the row if invalid. */
    showErrors?: boolean;
    /** Value editor for a relation-id rule; forwarded to {@link ValueEditor}. */
    renderRelationValue?: RelationValueEditor;
    /**
     * Called after this row's remove button is activated, with the button
     * element that was pressed — so the parent can put focus somewhere real
     * before the row unmounts underneath it.
     */
    onRemoveFocus?: (trigger: HTMLElement) => void;
};

/**
 * One field/op/value rule. Changing the field auto-resets `op` to the
 * first valid operator for the new field type and seeds a value matching
 * the op's expected shape (via {@link defaultValueForOp}); changing the
 * op reseeds the value the same way. Both invariants mean a rule never
 * sits in an "op valid on the previous type but not this one" state
 * that would 400 at the BE.
 */
export function RuleRow({
    rule,
    fields,
    onUpdate,
    onRemove,
    showErrors = false,
    renderRelationValue,
    onRemoveFocus
}: RuleRowProps) {
    const intl = useIntl();
    // No `?? fields[0]` fallback: substituting an unrelated field would drive
    // the operator list and the inline validation off the WRONG type while
    // `rule.fieldId` kept the stale path — the row would look valid while the
    // Apply gate (which resolves by id) silently refused to commit. Leaving it
    // undefined lets the row say what's actually wrong. The field cell still
    // renders, so re-picking is the fix.
    const field: FilterField | undefined = fields.find(
        (f) => f.id === rule.fieldId
    );
    const ops = field ? opsForField(field) : [];
    // An unknown field is a broken rule, not an unfinished one, so it reports
    // regardless of `showErrors` — the user never typed it and has no draft to
    // finish. An operator the field doesn't offer is the same kind of thing and
    // is worse to leave silent: the picker has no matching item, so the cell
    // renders blank and the row reads as merely unfinished.
    const validation = field ? validateRule(rule, field) : null;
    const errorCode: RuleValidationCode | null = !field
        ? RULE_VALIDATION.UnknownField
        : validation === RULE_VALIDATION.OperatorNotAllowed
          ? validation
          : showErrors
            ? validation
            : null;
    const errorId = useId();
    // The row's identity, used by every control's name and by its error text.
    const path = fieldPath(intl, fields, rule.fieldId);

    return (
        <div className="flex flex-col gap-1">
            {/* Top-align the cells: a relation value editor stacks its trigger
                over the selected chips, so centering would float the field /
                operator above it. Top-aligned, the field, operator, and value
                trigger line up and the chips simply hang below. */}
            <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-[7rem] flex-1 basis-0">
                    <FieldPicker
                        label={intl.formatMessage(messages.fieldFor, { path })}
                        fields={fields}
                        value={rule.fieldId}
                        onChange={(fieldId) => {
                            const nextField = fields.find(
                                (f) => f.id === fieldId
                            );
                            if (!nextField) return;
                            const nextOp = opsForField(nextField)[0];
                            onUpdate({
                                fieldId,
                                op: nextOp,
                                value: defaultValueForOp(nextOp)
                            });
                        }}
                    />
                </div>
                {field && (
                    <div className="min-w-[7rem] flex-1 basis-0">
                        <OperatorPicker
                            label={intl.formatMessage(messages.operatorFor, {
                                path
                            })}
                            ops={ops}
                            value={rule.op}
                            onChange={(op: OpId) =>
                                onUpdate({ op, value: defaultValueForOp(op) })
                            }
                        />
                    </div>
                )}
                {field &&
                    rule.op !== OP.IsEmpty &&
                    rule.op !== OP.IsNotEmpty && (
                        <div className="min-w-[8rem] flex-[1.5] basis-0">
                            <ValueEditor
                                field={field}
                                op={rule.op}
                                value={rule.value}
                                onChange={(value) => onUpdate({ value })}
                                invalid={errorCode !== null}
                                describedById={errorCode ? errorId : undefined}
                                renderRelationValue={renderRelationValue}
                            />
                        </div>
                    )}
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    data-qb-remove
                    aria-label={intl.formatMessage(messages.removeRule, {
                        path
                    })}
                    onClick={(event) => {
                        // Hand focus on *before* the row goes: the focused
                        // button unmounts with it, so focus fell to `<body>`
                        // and the next Tab restarted at the top of the document
                        // — removing the third of five conditions cost a full
                        // re-traverse (2.4.3, `ORT-157`).
                        onRemoveFocus?.(event.currentTarget);
                        onRemove();
                    }}
                    className="size-7 shrink-0"
                >
                    <X aria-hidden className="size-3.5" />
                </Button>
            </div>
            {errorCode && (
                <p
                    id={errorId}
                    role="alert"
                    className="text-destructive text-xs pl-1"
                    data-testid="qb-rule-error"
                >
                    {intl.formatMessage(messages.errorForField, {
                        path,
                        message: intl.formatMessage(ERROR_BY_CODE[errorCode])
                    })}
                </p>
            )}
        </div>
    );
}
