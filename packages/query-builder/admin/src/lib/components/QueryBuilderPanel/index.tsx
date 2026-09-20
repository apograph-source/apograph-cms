import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Alert,
    AlertDescription,
    AlertTitle,
    Button,
    Spinner
} from '@orthacms/design-system';
import type {
    FilterField,
    RelationValueEditor
} from '../../types/filter-field.type';
import type { FilterGroup } from '../../types/filter-tree.type';
import { countRules } from '../../utils/countRules';
import { treeHasInvalidRules } from '../../utils/validateRule';
import { QueryBuilder } from '../QueryBuilder';
import { JsonPreview } from '../QueryBuilderDrawer/JsonPreview';

const messages = defineMessages({
    conditions: {
        id: 'qb.panel.conditions',
        defaultMessage:
            '{count, plural, =0 {No conditions} one {# condition} other {# conditions}}'
    },
    apply: { id: 'qb.panel.apply', defaultMessage: 'Apply' },
    reset: { id: 'qb.panel.reset', defaultMessage: 'Reset' },
    loading: {
        id: 'qb.panel.loading',
        defaultMessage: 'Loading filterable fields…'
    },
    errorTitle: {
        id: 'qb.panel.errorTitle',
        defaultMessage: "Couldn't load the filterable fields"
    },
    errorBody: {
        id: 'qb.panel.errorBody',
        defaultMessage:
            'Filters are unavailable until this loads. Any filter already applied is still in effect.'
    },
    retry: { id: 'qb.panel.retry', defaultMessage: 'Try again' }
});

/** Props for {@link QueryBuilderPanel}. */
export type QueryBuilderPanelProps = {
    /** Whether the panel is expanded. The consumer owns the toggle button. */
    open: boolean;
    /** Called to collapse the panel (Apply, Esc). */
    onOpenChange: (open: boolean) => void;
    /** Available filter fields. */
    fields: readonly FilterField[];
    /** The applied filter tree (URL-driven). `null` when no rules are set. */
    value: FilterGroup | null;
    /** Called on Apply (with the next tree) or Reset (with `null`). */
    onApply: (next: FilterGroup | null) => void;
    /** Called after a successful **Apply** (not Reset) — e.g. to toast. */
    onApplied?: () => void;
    /** Record picker for a relation-id rule, forwarded to the builder. */
    renderRelationValue?: RelationValueEditor;
    /** `id` of the toggle button, so the region is labelled by it. */
    labelledBy?: string;
    /** `id` for the region element (the toggle's `aria-controls` target). */
    id?: string;
    /**
     * `fields` has not loaded yet. Renders a loading state instead of the
     * builder — a rule whose field is missing can never pass the Apply gate,
     * so showing an empty picker would just look broken.
     */
    fieldsPending?: boolean;
    /**
     * Loading `fields` failed. Renders an error state with {@link onRetryFields}
     * instead of the builder. Distinct from "the type has no filterable
     * fields", which is a legitimately empty picker.
     */
    fieldsError?: boolean;
    /** Retry the `fields` request; renders a Try again action when set. */
    onRetryFields?: () => void;
};

/**
 * Inline, full-width accordion hosting a {@link QueryBuilder} — the in-page
 * alternative to `QueryBuilderDrawer`. It sits between the records toolbar and
 * the table and pushes the table down when open (no overlay, no backdrop). The
 * consumer owns the toggle button (in the toolbar) and the `open` state; this
 * owns the staged `draft`, the Apply/Reset footer, and the collapse-on-Apply /
 * Esc behaviour.
 *
 * Open/close animates the height via `grid-template-rows` `0fr → 1fr` (~150ms,
 * no fade/scale), and honours `prefers-reduced-motion`. The rules list caps its
 * height and scrolls internally so the table is never pushed off-screen; the
 * JSON preview and footer stay pinned below it.
 */
export function QueryBuilderPanel({
    open,
    onOpenChange,
    fields,
    value,
    onApply,
    onApplied,
    renderRelationValue,
    labelledBy,
    id,
    fieldsPending = false,
    fieldsError = false,
    onRetryFields
}: QueryBuilderPanelProps) {
    const intl = useIntl();
    const [draft, setDraft] = useState<FilterGroup | null>(value);
    // Inline errors stay hidden until Apply is pressed on an invalid draft.
    const [showErrors, setShowErrors] = useState(false);
    const regionRef = useRef<HTMLDivElement>(null);

    // Sync the draft to the applied filter every time the panel opens, so the
    // user always edits the current state; closing without Apply discards edits.
    useEffect(() => {
        if (open) {
            setDraft(value);
            setShowErrors(false);
        }
    }, [open, value]);

    // Errors fade out as the draft becomes valid — no need to re-press Apply.
    useEffect(() => {
        if (showErrors && !treeHasInvalidRules(draft, fields)) {
            setShowErrors(false);
        }
    }, [draft, fields, showErrors]);

    // Move focus into the first condition's field cell when the panel opens.
    // Re-runs once the fields resolve, since until then the builder — and so
    // the field cell — isn't rendered at all.
    //
    // `preventScroll`, because this focus lands *mid-animation*. The panel
    // opens by growing `grid-template-rows` from `0fr`, so at the instant the
    // effect runs the clipping `overflow-hidden` wrapper is still a few pixels
    // tall — and a plain `focus()` makes the browser scroll that wrapper (to
    // ~85px) to reveal the control. Nothing needed revealing: the wrapper is
    // about to be tall enough to show the whole panel. The scroll is then
    // clamped back to 0 as the row grows, which slides every control inside the
    // panel — the Apply button included — by tens of pixels for a few hundred
    // milliseconds *after* the 150ms transition has ended. A user who presses
    // Apply during that slide can have the press dropped outright: `mousedown`
    // lands on the button, the contents shift under the cursor, `mouseup` lands
    // on something else, and the browser fires `click` on their common
    // ancestor rather than on the button. Focusing without scrolling keeps the
    // behaviour this effect exists for (2.4.3, `ORT-157`) and leaves the layout
    // still.
    useEffect(() => {
        if (!open || fieldsPending || fieldsError) return;
        regionRef.current
            ?.querySelector<HTMLElement>('[role="combobox"]')
            ?.focus({ preventScroll: true });
    }, [open, fieldsPending, fieldsError]);

    // Without the field definitions every rule fails the Apply gate (a rule
    // whose field can't be resolved is never valid), so committing is
    // impossible — say so with a disabled button rather than a dead one.
    const fieldsReady = !fieldsPending && !fieldsError;

    const apply = () => {
        if (treeHasInvalidRules(draft, fields)) {
            setShowErrors(true);
            // Take the user to the first thing that is wrong. A failed Apply
            // otherwise inserted three `role="alert"` paragraphs at once, which
            // screen readers coalesce or drop — and left focus on the Apply
            // button, so finding the offending row meant tabbing the whole
            // builder (3.3.1, `ORT-157`). The errors render in the same commit
            // as `showErrors`, so the query has to wait for it.
            requestAnimationFrame(() => {
                const firstError =
                    regionRef.current?.querySelector<HTMLElement>(
                        '[data-testid="qb-rule-error"]'
                    );
                // The row's first control, not the message: a message is not
                // focusable, and the control is what the user has to change.
                firstError?.parentElement
                    ?.querySelector<HTMLElement>(
                        'input, select, [role="combobox"], button'
                    )
                    ?.focus();
            });
            return;
        }
        const hasRules = draft && draft.children.length > 0;
        onApply(hasRules ? draft : null);
        onApplied?.();
        // The panel stays open after Apply — the URL/table update, but the
        // builder remains expanded for further edits (the toggle collapses it).
    };

    const reset = () => {
        setDraft(null);
        setShowErrors(false);
        onApply(null);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        // Esc collapses the panel — but let an open popover (the field/value
        // pickers) swallow its own Escape first.
        if (event.key !== 'Escape' || event.defaultPrevented) return;

        // Hand focus back to the control that opened this. Collapsing makes the
        // `<section>` `inert` while focus is inside it, so without this the
        // browser dropped focus to `<body>` and the next Tab restarted at the
        // top of the document — the panel deliberately moves focus *in* on open
        // and did nothing on the way out (2.4.3, `ORT-157`). `labelledBy` names
        // the toggle, which is exactly the element to return to.
        const toggle = labelledBy ? document.getElementById(labelledBy) : null;
        onOpenChange(false);
        // After the commit that sets `inert`: focusing first would be undone by
        // the browser blurring an element inside an inert subtree.
        requestAnimationFrame(() => toggle?.focus());
    };

    return (
        <div
            className="grid transition-[grid-template-rows] duration-150 ease-out motion-reduce:transition-none"
            style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
        >
            <div className="overflow-hidden">
                <section
                    ref={regionRef}
                    id={id}
                    role="region"
                    aria-labelledby={labelledBy}
                    inert={!open}
                    onKeyDown={onKeyDown}
                    className="mb-6 flex flex-col gap-4 rounded-2xl border bg-muted/50 p-5"
                >
                    {fieldsError ? (
                        <Alert variant="destructive" role="alert">
                            <AlertTitle>
                                {intl.formatMessage(messages.errorTitle)}
                            </AlertTitle>
                            <AlertDescription className="flex flex-col items-start gap-2">
                                {intl.formatMessage(messages.errorBody)}
                                {onRetryFields ? (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={onRetryFields}
                                    >
                                        {intl.formatMessage(messages.retry)}
                                    </Button>
                                ) : null}
                            </AlertDescription>
                        </Alert>
                    ) : fieldsPending ? (
                        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                            <Spinner aria-hidden className="size-4" />
                            {intl.formatMessage(messages.loading)}
                        </p>
                    ) : (
                        <>
                            <div className="max-h-[22rem] overflow-y-auto pr-1">
                                <QueryBuilder
                                    fields={fields}
                                    value={draft}
                                    onChange={setDraft}
                                    showErrors={showErrors}
                                    renderRelationValue={renderRelationValue}
                                />
                            </div>
                            <JsonPreview tree={draft} />
                        </>
                    )}
                    <div className="flex items-center justify-between gap-2 border-t pt-4">
                        <span className="text-xs text-muted-foreground tabular-nums">
                            {intl.formatMessage(messages.conditions, {
                                count: countRules(draft)
                            })}
                        </span>
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={reset}
                            >
                                {intl.formatMessage(messages.reset)}
                            </Button>
                            <Button
                                type="button"
                                onClick={apply}
                                disabled={!fieldsReady}
                            >
                                {intl.formatMessage(messages.apply)}
                            </Button>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
