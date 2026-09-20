import { useMemo, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import type { Editor } from '@tiptap/react';
import { Bold, Italic, List, ListOrdered, Redo2, Undo2 } from 'lucide-react';
import { byOrder } from '@orthacms/utils-admin';
import {
    WYSIWYG_MEDIA_KINDS,
    type WysiwygMediaKind
} from '../../../domain/constants';
import {
    WYSIWYG_MEDIA_SLOT,
    type WysiwygMediaEmbed
} from '../../slots/wysiwygSlots';
import { useLiveEditorState } from '../../hooks/useLiveEditorState';
import { AlignMenu } from './AlignMenu';
import { BlockTypeMenu } from './BlockTypeMenu';
import { COLOR_KIND, ColorMenu } from './ColorMenu';
import { FontSizeMenu } from './FontSizeMenu';
import { InsertMenu } from './InsertMenu';
import { LanguageDialog } from './LanguageDialog';
import { LinkPopover } from './LinkPopover';
import { MediaUrlDialog } from './MediaUrlDialog';
import { MoreMarksMenu } from './MoreMarksMenu';
import { ToolbarButton } from './ToolbarButton';

const messages = defineMessages({
    toolbar: {
        id: 'wysiwyg.toolbar.label',
        defaultMessage: 'Formatting'
    },
    undo: { id: 'wysiwyg.toolbar.undo', defaultMessage: 'Undo' },
    redo: { id: 'wysiwyg.toolbar.redo', defaultMessage: 'Redo' },
    bold: { id: 'wysiwyg.toolbar.bold', defaultMessage: 'Bold' },
    italic: { id: 'wysiwyg.toolbar.italic', defaultMessage: 'Italic' },
    bulletList: {
        id: 'wysiwyg.toolbar.bulletList',
        defaultMessage: 'Bulleted list'
    },
    orderedList: {
        id: 'wysiwyg.toolbar.orderedList',
        defaultMessage: 'Numbered list'
    }
});

/** Every toggle off, neither history direction available — what a toolbar
 *  reports for the frame in which its editor no longer exists. */
const TOOLBAR_INERT = {
    bold: false,
    italic: false,
    bulletList: false,
    orderedList: false,
    canUndo: false,
    canRedo: false
};

/**
 * A hairline between two runs of controls. Decorative — never announced.
 *
 * No horizontal margin: the bar's own `gap` already puts 2px either side, and
 * five separators' margins were the last ~20px that tipped the bar onto a
 * second row.
 */
function ToolbarSeparator() {
    return <span aria-hidden className="h-5 w-px shrink-0 bg-border" />;
}

/**
 * The editor's control bar — **one row**.
 *
 * That constraint is the design. Twenty flat controls wrapped onto a second
 * line at ordinary window widths, which moved every control below it and made
 * the last few feel like an afterthought. So the bar keeps out front only what
 * is reached mid-sentence — undo/redo, the block type, size, bold/italic, the
 * two colors, the two lists, and links — and folds the rest into three menus
 * that group by *what the action is*, not by what happened to fit:
 *
 * - {@link MoreMarksMenu} — underline, strikethrough, inline code, quote, clear
 *   formatting.
 * - {@link AlignMenu} — the four alignments, which were always mutually
 *   exclusive and so were four buttons doing a radio group's job.
 * - {@link InsertMenu} — tables, columns, callouts, dividers: "put a block
 *   here", each with its own submenu for editing that block.
 *
 * `flex-wrap` stays as the fallback for a genuinely narrow window — wrapping is
 * bad, clipping the last controls off the edge is worse.
 *
 * Deliberately a `role="group"`, not `role="toolbar"`: the ARIA toolbar pattern
 * promises arrow-key navigation with a single tab stop, and promising it
 * without implementing it strands screen-reader users who then arrow into
 * nothing. As a group every control is an ordinary tab stop, which is honest
 * and works today.
 *
 * The bar subscribes to the editor once, here, for the plain toggles; each
 * dropdown owns the slice of state it needs. That keeps this file from becoming
 * a single selector that every menu re-renders through.
 */
export function WysiwygToolbar({ editor }: { editor: Editor }) {
    const intl = useIntl();
    const state = useLiveEditorState(
        editor,
        (instance) => ({
            bold: instance.isActive('bold'),
            italic: instance.isActive('italic'),
            bulletList: instance.isActive('bulletList'),
            orderedList: instance.isActive('orderedList'),
            canUndo: instance.can().undo(),
            canRedo: instance.can().redo()
        }),
        TOOLBAR_INERT
    );

    // Contributed media sources, ordered once — the slot is boot-frozen, so
    // there is nothing to recompute.
    const mediaSources = useMemo(
        () => byOrder([...WYSIWYG_MEDIA_SLOT.getItems()]),
        []
    );
    /** Which contributed source is open, by item id. */
    const [openSource, setOpenSource] = useState<string | null>(null);
    /** Which built-in URL dialog is open, by the kind it inserts. */
    const [urlKind, setUrlKind] = useState<WysiwygMediaKind | null>(null);
    /** Whether the language-of-parts dialog is open. */
    const [languageOpen, setLanguageOpen] = useState(false);

    const insertMedia = (embeds: WysiwygMediaEmbed[]) => {
        editor.chain().focus().insertMedia(embeds).run();
    };

    return (
        <>
            <div
                role="group"
                aria-label={intl.formatMessage(messages.toolbar)}
                className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/40 px-2 py-1.5"
            >
                <ToolbarButton
                    label={intl.formatMessage(messages.undo)}
                    icon={Undo2}
                    disabled={!state.canUndo}
                    onClick={() => editor.chain().focus().undo().run()}
                />
                <ToolbarButton
                    label={intl.formatMessage(messages.redo)}
                    icon={Redo2}
                    disabled={!state.canRedo}
                    onClick={() => editor.chain().focus().redo().run()}
                />

                <ToolbarSeparator />

                <BlockTypeMenu editor={editor} />
                <FontSizeMenu editor={editor} />

                <ToolbarSeparator />

                <ToolbarButton
                    label={intl.formatMessage(messages.bold)}
                    icon={Bold}
                    active={state.bold}
                    onClick={() => editor.chain().focus().toggleBold().run()}
                />
                <ToolbarButton
                    label={intl.formatMessage(messages.italic)}
                    icon={Italic}
                    active={state.italic}
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                />
                <MoreMarksMenu
                    editor={editor}
                    onOpenLanguage={() => setLanguageOpen(true)}
                />

                <ToolbarSeparator />

                <ColorMenu editor={editor} kind={COLOR_KIND.Text} />
                <ColorMenu editor={editor} kind={COLOR_KIND.Highlight} />

                <ToolbarSeparator />

                <ToolbarButton
                    label={intl.formatMessage(messages.bulletList)}
                    icon={List}
                    active={state.bulletList}
                    onClick={() =>
                        editor.chain().focus().toggleBulletList().run()
                    }
                />
                <ToolbarButton
                    label={intl.formatMessage(messages.orderedList)}
                    icon={ListOrdered}
                    active={state.orderedList}
                    onClick={() =>
                        editor.chain().focus().toggleOrderedList().run()
                    }
                />
                <AlignMenu editor={editor} />

                <ToolbarSeparator />

                <LinkPopover editor={editor} />
                <InsertMenu
                    editor={editor}
                    mediaSources={mediaSources}
                    onOpenMediaSource={setOpenSource}
                    onOpenMediaUrl={setUrlKind}
                />
            </div>

            {/* Mounted outside the menu that opens it, for the same reason the
            media sources are — see below. */}
            <LanguageDialog
                editor={editor}
                open={languageOpen}
                onOpenChange={setLanguageOpen}
            />

            {/* Media sources are mounted **here**, outside the menu that opens
            them. `DropdownMenuContent` unmounts the moment the menu closes —
            which is precisely when a picker is meant to appear — so a dialog
            rendered inside it would open into a tree being torn down. Same
            reason content-admin renders its ⋯-menu items' overlays outside the
            menu. Mounted for the editor's whole life, each source keeps its own
            state across openings. */}
            {mediaSources.map((source) => (
                <source.Source
                    key={source.id}
                    open={openSource === source.id}
                    onOpenChange={(next) =>
                        setOpenSource(next ? source.id : null)
                    }
                    accept={WYSIWYG_MEDIA_KINDS}
                    onInsert={insertMedia}
                />
            ))}

            {urlKind ? (
                <MediaUrlDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setUrlKind(null);
                    }}
                    kind={urlKind}
                    onInsert={insertMedia}
                />
            ) : null}
        </>
    );
}
