import { defineMessages, useIntl } from 'react-intl';
import { Plus, X } from 'lucide-react';
import {
    Button,
    SegmentedControl,
    SegmentedControlItem,
    cn
} from '@orthacms/design-system';
import type {
    FilterField,
    RelationValueEditor
} from '../../../types/filter-field.type';
import {
    COMBINATOR,
    isRule,
    type Combinator,
    type FilterGroup,
    type FilterRule
} from '../../../types/filter-tree.type';
import { RuleRow } from './RuleRow';

const messages = defineMessages({
    and: { id: 'qb.group.and', defaultMessage: 'AND' },
    or: { id: 'qb.group.or', defaultMessage: 'OR' },
    addRule: { id: 'qb.group.addRule', defaultMessage: 'Add rule' },
    addGroup: { id: 'qb.group.addGroup', defaultMessage: 'Add group' },
    removeGroup: {
        id: 'qb.group.removeGroup',
        defaultMessage: 'Remove group'
    },
    combinator: { id: 'qb.group.combinator', defaultMessage: 'Combinator' },
    // Nested groups are numbered so their four controls are distinguishable
    // from each other and from the root's. Without this a builder with two
    // sub-groups offered two "Add rule", two "Add group", two "Remove group"
    // and two "Combinator" controls with identical names (`ORT-157`).
    addRuleTo: {
        id: 'qb.group.addRuleTo',
        defaultMessage: 'Add rule to group {index}'
    },
    addGroupTo: {
        id: 'qb.group.addGroupTo',
        defaultMessage: 'Add group inside group {index}'
    },
    removeGroupAt: {
        id: 'qb.group.removeGroupAt',
        defaultMessage: 'Remove group {index}'
    },
    combinatorFor: {
        id: 'qb.group.combinatorFor',
        defaultMessage: 'Combinator for group {index}'
    },
    group: { id: 'qb.group.label', defaultMessage: 'Group {index}' }
});

/** Bag of mutation callbacks the recursive group tree threads down. */
export type GroupNodeOps = {
    onAddRule: (parentGroupId: string) => void;
    onAddGroup: (parentGroupId: string) => void;
    onUpdateRule: (ruleId: string, patch: Partial<FilterRule>) => void;
    onUpdateCombinator: (groupId: string, combinator: Combinator) => void;
    onRemoveNode: (nodeId: string) => void;
};

/** Props for {@link GroupNode}. */
export type GroupNodeProps = {
    group: FilterGroup;
    fields: readonly FilterField[];
    /** True only for the outermost group — controls border + remove affordance. */
    isRoot?: boolean;
    ops: GroupNodeOps;
    /** Surface inline validation errors under invalid rules. */
    showErrors?: boolean;
    /** Value editor for relation-id rules; threaded to every {@link RuleRow}. */
    renderRelationValue?: RelationValueEditor;
    /**
     * This group's position among its siblings, 1-based — used to name its
     * controls. Absent on the root, which needs no number because there is only
     * one of it.
     */
    index?: number;
    /** Forwarded to every {@link RuleRow}; see `RuleRowProps.onRemoveFocus`. */
    onRemoveFocus?: (trigger: HTMLElement) => void;
};

/**
 * Recursive group renderer. Each group owns a combinator toggle, a list
 * of children (rules and nested groups), and a small footer with `Add
 * rule` / `Add group` actions. Non-root groups render with a dashed
 * border + "Remove group" affordance so the nesting structure is
 * legible without parentheses.
 */
export function GroupNode({
    group,
    fields,
    isRoot = false,
    ops,
    showErrors = false,
    renderRelationValue,
    index,
    onRemoveFocus
}: GroupNodeProps) {
    const intl = useIntl();

    // A nested group's controls are named for the group they act on; the root's
    // keep the plain names, because there is only one root and numbering it
    // would be noise.
    const scoped = (
        scopedMessage: (typeof messages)[keyof typeof messages],
        plain: (typeof messages)[keyof typeof messages]
    ) =>
        index === undefined
            ? intl.formatMessage(plain)
            : intl.formatMessage(scopedMessage, { index });

    return (
        <div
            className={cn(
                'flex flex-col gap-2',
                !isRoot && 'rounded-md border border-dashed p-3'
            )}
            // A named region, so the nesting is navigable rather than something
            // a screen-reader user has to infer from the order of the controls.
            {...(index === undefined
                ? {}
                : {
                      role: 'group',
                      'aria-label': intl.formatMessage(messages.group, {
                          index
                      })
                  })}
        >
            <div className="flex items-center justify-between">
                <SegmentedControl
                    value={group.combinator}
                    onValueChange={(v) => {
                        if (v === COMBINATOR.And || v === COMBINATOR.Or) {
                            ops.onUpdateCombinator(group.id, v);
                        }
                    }}
                    aria-label={scoped(
                        messages.combinatorFor,
                        messages.combinator
                    )}
                >
                    <SegmentedControlItem value={COMBINATOR.And}>
                        {intl.formatMessage(messages.and)}
                    </SegmentedControlItem>
                    <SegmentedControlItem value={COMBINATOR.Or}>
                        {intl.formatMessage(messages.or)}
                    </SegmentedControlItem>
                </SegmentedControl>
                {!isRoot && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        data-qb-remove
                        aria-label={scoped(
                            messages.removeGroupAt,
                            messages.removeGroup
                        )}
                        onClick={(event) => {
                            onRemoveFocus?.(event.currentTarget);
                            ops.onRemoveNode(group.id);
                        }}
                        className="size-7"
                    >
                        <X aria-hidden className="size-3.5" />
                    </Button>
                )}
            </div>

            {group.children.length > 0 && (
                <div className="flex flex-col gap-2">
                    {group.children.map((child) =>
                        isRule(child) ? (
                            <RuleRow
                                key={child.id}
                                rule={child}
                                fields={fields}
                                onUpdate={(patch) =>
                                    ops.onUpdateRule(child.id, patch)
                                }
                                onRemove={() => ops.onRemoveNode(child.id)}
                                onRemoveFocus={onRemoveFocus}
                                showErrors={showErrors}
                                renderRelationValue={renderRelationValue}
                            />
                        ) : (
                            <GroupNode
                                key={child.id}
                                group={child}
                                fields={fields}
                                ops={ops}
                                index={groupIndexOf(group, child.id)}
                                onRemoveFocus={onRemoveFocus}
                                showErrors={showErrors}
                                renderRelationValue={renderRelationValue}
                            />
                        )
                    )}
                </div>
            )}

            <div className="flex gap-2">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-qb-add-rule
                    aria-label={scoped(messages.addRuleTo, messages.addRule)}
                    onClick={() => ops.onAddRule(group.id)}
                >
                    <Plus aria-hidden className="size-3.5" />
                    {intl.formatMessage(messages.addRule)}
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={scoped(messages.addGroupTo, messages.addGroup)}
                    onClick={() => ops.onAddGroup(group.id)}
                >
                    <Plus aria-hidden className="size-3.5" />
                    {intl.formatMessage(messages.addGroup)}
                </Button>
            </div>
        </div>
    );
}

/**
 * The 1-based position of `childId` among `parent`'s **sub-groups** — not among
 * all its children, so the numbering a user hears counts groups the way they
 * see them, and stays stable when a rule is added between two of them.
 */
function groupIndexOf(parent: FilterGroup, childId: string): number {
    return (
        parent.children
            .filter((child) => !isRule(child))
            .findIndex((child) => child.id === childId) + 1
    );
}
