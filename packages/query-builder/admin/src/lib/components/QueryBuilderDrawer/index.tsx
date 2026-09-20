import { useEffect, useState, type ReactNode } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Button,
    Drawer,
    DrawerContent,
    DrawerDescription,
    DrawerFooter,
    DrawerHeader,
    DrawerTitle,
    DrawerTrigger
} from '@orthacms/design-system';
import type {
    FilterField,
    RelationValueEditor
} from '../../types/filter-field.type';
import type { FilterGroup } from '../../types/filter-tree.type';
import { treeHasInvalidRules } from '../../utils/validateRule';
import { QueryBuilder } from '../QueryBuilder';
import { JsonPreview } from './JsonPreview';

const messages = defineMessages({
    title: {
        id: 'qb.drawer.title',
        defaultMessage: 'Query Builder'
    },
    description: {
        id: 'qb.drawer.description',
        defaultMessage:
            'Build conditions to narrow results. Apply commits the result to the URL.'
    },
    conditions: {
        id: 'qb.drawer.conditions',
        defaultMessage: 'Conditions'
    },
    conditionsHint: {
        id: 'qb.drawer.conditionsHint',
        defaultMessage:
            'Combine rules with AND or OR; use Add group to nest sub-conditions.'
    },
    apply: { id: 'qb.drawer.apply', defaultMessage: 'Apply' },
    reset: { id: 'qb.drawer.reset', defaultMessage: 'Reset' }
});

/** Props for {@link QueryBuilderDrawer}. */
export type QueryBuilderDrawerProps = {
    /** Available filter fields — usually a static schema mirror of the BE. */
    fields: readonly FilterField[];
    /** Applied filter tree (URL-driven). `null` when no rules are set. */
    value: FilterGroup | null;
    /** Called on Apply (with the next tree) or Reset (with `null`). */
    onApply: (next: FilterGroup | null) => void;
    /**
     * Trigger element. The drawer renders it inside `<DrawerTrigger asChild>`,
     * so a button (or any element with `asChild` support) is correct here.
     * The consumer owns the label/icon/badge so a "Filters (3)" badge or a
     * permission-gated button stays at the call site.
     */
    trigger: ReactNode;
    /** Drawer edge to slide from. Defaults to `'right'`. */
    direction?: 'left' | 'right';
    /** Value editor for relation-id rules; forwarded to the {@link QueryBuilder}. */
    renderRelationValue?: RelationValueEditor;
};

/**
 * Self-contained drawer hosting a {@link QueryBuilder}. Owns the open
 * state, the staged `draft` (synced from `value` on every open so a
 * close-without-Apply discards edits), and the Apply/Reset commit
 * footer. Everything inside the drawer — title, description, section
 * heading, button labels — is package-owned so the experience is
 * identical wherever the drawer is mounted in the admin.
 *
 * The headless {@link QueryBuilder} is still exported separately for
 * inline / non-drawer use cases.
 */
export function QueryBuilderDrawer({
    fields,
    value,
    onApply,
    trigger,
    direction = 'right',
    renderRelationValue
}: QueryBuilderDrawerProps) {
    const intl = useIntl();
    const [open, setOpen] = useState(false);
    // The drawer's own element. vaul scroll-locks the page while open, so the
    // field picker's popover must portal INTO this node (react-remove-scroll's
    // allow-listed subtree) or its list won't scroll by mouse wheel.
    const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
    const [draft, setDraft] = useState<FilterGroup | null>(value);
    // Inline rule errors stay hidden until the user clicks Apply with an
    // invalid draft; we don't pre-shame freshly-added rules.
    const [showErrors, setShowErrors] = useState(false);

    // Sync the draft to the applied filter every time the drawer opens
    // so the user always sees the current state, not a stale one from
    // last session. Closing without Apply discards local edits — and
    // clears any error state from the previous attempt.
    useEffect(() => {
        if (open) {
            setDraft(value);
            setShowErrors(false);
        }
    }, [open, value]);

    // Once the user fixes their rules the inline errors fade out as the
    // tree becomes valid — no need to wait for another Apply.
    useEffect(() => {
        if (showErrors && !treeHasInvalidRules(draft, fields)) {
            setShowErrors(false);
        }
    }, [draft, fields, showErrors]);

    const apply = () => {
        if (treeHasInvalidRules(draft, fields)) {
            setShowErrors(true);
            return;
        }
        const hasRules = draft && draft.children.length > 0;
        onApply(hasRules ? draft : null);
        setOpen(false);
    };

    const reset = () => {
        setDraft(null);
        setShowErrors(false);
        onApply(null);
        setOpen(false);
    };

    return (
        <Drawer direction={direction} open={open} onOpenChange={setOpen}>
            <DrawerTrigger asChild>{trigger}</DrawerTrigger>
            <DrawerContent ref={setContentEl} className="gap-6 p-6">
                <DrawerHeader className="space-y-1 p-0">
                    <DrawerTitle>
                        {intl.formatMessage(messages.title)}
                    </DrawerTitle>
                    <DrawerDescription>
                        {intl.formatMessage(messages.description)}
                    </DrawerDescription>
                </DrawerHeader>
                <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
                    <div className="flex flex-col gap-3">
                        <div className="space-y-1">
                            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {intl.formatMessage(messages.conditions)}
                            </h3>
                            <p className="text-xs text-muted-foreground">
                                {intl.formatMessage(messages.conditionsHint)}
                            </p>
                        </div>
                        <QueryBuilder
                            fields={fields}
                            value={draft}
                            onChange={setDraft}
                            showErrors={showErrors}
                            renderRelationValue={renderRelationValue}
                            portalContainer={contentEl}
                        />
                    </div>
                    <JsonPreview tree={draft} />
                </div>
                <DrawerFooter className="mt-auto flex-row justify-end gap-2 p-0">
                    <Button type="button" variant="ghost" onClick={reset}>
                        {intl.formatMessage(messages.reset)}
                    </Button>
                    <Button type="button" onClick={apply}>
                        {intl.formatMessage(messages.apply)}
                    </Button>
                </DrawerFooter>
            </DrawerContent>
        </Drawer>
    );
}
