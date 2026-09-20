import { Extension } from '@tiptap/core';
import { Table } from '@tiptap/extension-table';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/**
 * Bounds what `Tab` does at the end of a table.
 *
 * `@tiptap/extension-table`'s own binding never returns `false` in a table the
 * author can edit:
 *
 * ```js
 * Tab: () => {
 *   if (this.editor.commands.goToNextCell()) return true;
 *   if (!this.editor.can().addRowAfter()) return false;
 *   return this.editor.chain().addRowAfter().goToNextCell().run();
 * }
 * ```
 *
 * At the last cell it appends a row and moves into it — Word's and Google Docs'
 * behaviour, and genuinely wanted by an author who is building a table. But it
 * means an author who is merely trying to **leave** grows the table one row per
 * press, with no undo prompt and no visible cause: measured at 3 rows to 9 over
 * 27 presses, with focus never escaping (`ORT-165`).
 *
 * The convention is kept and the runaway is not. Tab still appends a row at the
 * last cell — *once*. A second Tab through the row it just made, while that row
 * is still empty, falls through instead, so the editor's ordinary Tab handling
 * takes over and focus leaves the document. One press adds a row; the next
 * press leaves. Nothing an author does on purpose is taken away, because an
 * author who wanted the row is typing in it, which makes it non-empty and arms
 * the append again.
 *
 * Registered at a higher priority than `TableKit` so this binding is offered the
 * keystroke first. Returning `false` hands it back to the extensions below —
 * which is why {@link TableWithoutTab}, and not `Table`, is what the editor
 * registers: falling through to the table's *own* Tab is falling straight back
 * into the runaway this bounds.
 */
export const TableTab = Extension.create({
    name: 'orthaTableTab',

    // Above TableKit's default (100), so this is asked first.
    priority: 200,

    addKeyboardShortcuts() {
        return {
            Tab: () => {
                const { editor } = this;

                // Not in a table: nothing to bound. `false` lets the list
                // extensions and the editor's own handling have it.
                if (!editor.isActive('table')) return false;

                // Still cells to walk to — the ordinary case, and the one that
                // must stay fast.
                if (editor.commands.goToNextCell()) return true;

                // Last cell. Only append when the row the caret is in has been
                // written in; an empty trailing row is the one this handler
                // just made, and appending another would be the runaway.
                if (!lastRowHasContent(editor.state.selection.$anchor)) {
                    return false;
                }
                if (!editor.can().addRowAfter()) return false;
                return editor.chain().addRowAfter().goToNextCell().run();
            }
        };
    }
});

/**
 * `Table` with its own `Tab` binding taken off, so {@link TableTab} is the only
 * thing that answers the keystroke inside a table.
 *
 * Without this the bound above is a **no-op**. TipTap offers a shortcut to each
 * binding in priority order and stops at the first that returns `true`; a
 * `false` is "not handled", so it carries on down — and the next binding down is
 * `Table`'s, which is the exact code `TableTab` exists to bound:
 *
 * ```js
 * Tab: () => {
 *   if (this.editor.commands.goToNextCell()) return true;
 *   if (!this.editor.can().addRowAfter()) return false;
 *   return this.editor.chain().addRowAfter().goToNextCell().run();
 * }
 * ```
 *
 * So the fall-through appended the row anyway and focus never left. It did not
 * read as broken, because `addRowAfter().goToNextCell()` lands in the **first**
 * cell of the row it just made: the runaway simply moved one row further out,
 * to a row per lap of the table rather than a row per press. `ORT-165`
 *
 * Dropping the binding rather than overriding it is what makes `false` mean what
 * the comment above says: nothing below binds `Tab` inside a table, so the
 * keystroke reaches the browser and moves focus the ordinary way.
 */
export const TableWithoutTab = Table.extend({
    addKeyboardShortcuts() {
        // Shift-Tab, Backspace and the rest are kept; only Tab is surrendered.
        const { Tab: _tableTab, ...rest } = this.parent?.() ?? {};
        return rest;
    }
});

/**
 * Whether the last row of the table containing `$pos` has any text in it.
 *
 * Walks up to the enclosing `table` node rather than taking one from the
 * document, because tables nest (a table inside a column block) and the one
 * that matters is the one the caret is in. A table with no rows at all cannot
 * be produced by the insert command, but is treated as "no content" rather than
 * throwing.
 */
function lastRowHasContent($pos: {
    depth: number;
    node: (depth: number) => ProseMirrorNode;
}): boolean {
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
        const node = $pos.node(depth);
        if (node.type.name !== 'table') continue;
        if (node.childCount === 0) return false;
        const lastRow = node.child(node.childCount - 1);
        return lastRow.textContent.trim().length > 0;
    }
    return false;
}
