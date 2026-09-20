import type { ComponentType } from 'react';
import { createSlot } from '@orthacms/utils-admin';

/**
 * What a {@link CopilotToolResultItem}'s component is handed — one finished
 * tool call, from the transcript's own model.
 */
export type CopilotToolResultContext = {
    /** The registered tool name, e.g. `admin_alarms_findings`. */
    name: string;
    /** The arguments the model supplied. */
    input: unknown;
    /**
     * The tool's result.
     *
     * `unknown` on purpose: this package must not learn the shape of any one
     * plugin's output. A contribution narrows it itself, and must survive a
     * shape it does not recognise — the transcript is replayed from stored
     * history, so a result written by an older version of a tool can and will
     * arrive at a newer renderer.
     */
    output: unknown;
};

/**
 * A rich rendering of one tool's result, contributed by the plugin that owns
 * the tool.
 */
export type CopilotToolResultItem = {
    /** Stable id (also the React key). */
    id: string;
    /**
     * Which tool this renders. Exact match on the registered name — deliberately
     * not a predicate: a slot resolved by running arbitrary functions over every
     * step of every turn is a performance and a debugging problem, and no real
     * contribution has needed more.
     */
    toolName: string;
    /**
     * The component. Rendered **only** for a call that succeeded and returned
     * something, so it never has to handle a failure or an absent result — the
     * step's own error state already does.
     */
    Component: ComponentType<CopilotToolResultContext>;
};

/**
 * Rich renderings of tool results, keyed by tool name.
 *
 * Every tool call in the transcript is a collapsed line that expands to its raw
 * input and output, and for most tools that is right: the answer is the
 * assistant's prose, and the call is provenance. Some results are not like that
 * — a list of flagged records is *itself* the answer, and a JSON array two
 * clicks deep is a worse version of a thing the product already knows how to
 * draw.
 *
 * A contribution renders **beside** the raw payload, never instead of it: the
 * expanded panel still shows the exact output, because "no invisible actions"
 * ([`docs/design/copilot.md`](../../../../../../docs/design/copilot.md) §2) is
 * about being able to see precisely what the model was handed. The rich view is
 * an addition to that, not a replacement for it.
 *
 * The inversion is the usual one: this package owns the slot and knows no
 * plugin; the plugin that owns the tool owns the rendering. `@orthacms/alarms-admin`
 * is the first filler.
 */
export const COPILOT_TOOL_RESULT_SLOT = createSlot<CopilotToolResultItem>(
    'copilot.tool.result'
);

/**
 * The contribution for `name`, if one is registered.
 *
 * A plain `find` rather than a hook: this resolves a component, and mounting it
 * is what runs its hooks. Resolving with a hook here would put every
 * contribution's hooks in the *step's* scope and make their count depend on how
 * many tools a turn happened to call — a rules-of-hooks violation that only
 * shows up on the second turn.
 *
 * Last registration wins on a duplicate `toolName`, matching how the other
 * merge-by-id slots behave. Two plugins claiming one tool name is a
 * misconfiguration either way.
 */
export function toolResultRendererFor(
    name: string
): CopilotToolResultItem | undefined {
    const items = COPILOT_TOOL_RESULT_SLOT.getItems();
    for (let i = items.length - 1; i >= 0; i -= 1) {
        if (items[i].toolName === name) return items[i];
    }
    return undefined;
}
