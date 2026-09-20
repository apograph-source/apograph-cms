import { defineMessages, useIntl } from 'react-intl';
import type { Editor } from '@tiptap/react';
import {
    Columns3,
    Image as ImageIcon,
    Info,
    Minus,
    Plus,
    Table as TableIcon
} from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPortal,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger
} from '@orthacms/design-system';
import type { WysiwygMediaKind } from '../../../../domain/constants';
import type { WysiwygMediaSourceItem } from '../../../slots/wysiwygSlots';
import { useLiveEditorState } from '../../../hooks/useLiveEditorState';
import { ToolbarMenuTrigger } from '../ToolbarMenuTrigger';
import { CalloutItems } from './CalloutItems';
import { ColumnItems } from './ColumnItems';
import { MediaItems } from './MediaItems';
import { TableItems } from './TableItems';

const messages = defineMessages({
    label: { id: 'wysiwyg.insert.label', defaultMessage: 'Insert' },
    media: { id: 'wysiwyg.media.label', defaultMessage: 'Media' },
    table: { id: 'wysiwyg.table.label', defaultMessage: 'Table' },
    callout: { id: 'wysiwyg.callout.label', defaultMessage: 'Callout' },
    columns: { id: 'wysiwyg.columns.label', defaultMessage: 'Columns' },
    divider: {
        id: 'wysiwyg.toolbar.horizontalRule',
        defaultMessage: 'Divider'
    }
});

/**
 * The block-insertion menu: media, tables, callouts, column layouts, dividers.
 *
 * These were four separate toolbar controls, and they were the four that pushed
 * the bar onto a second line. Collapsing them behind one trigger is not just
 * space-saving — they are the same kind of action ("put a block here"), which
 * is why they read as a set rather than as an arbitrary bundle.
 *
 * Each of the three structured ones keeps its own submenu, so their per-block
 * editing (add a row, re-tone, reshape) stays where the block itself is rather
 * than being flattened into one long list.
 */
export function InsertMenu({
    editor,
    mediaSources,
    onOpenMediaSource,
    onOpenMediaUrl
}: {
    editor: Editor;
    /** Contributed media sources, already ordered. May be empty. */
    mediaSources: readonly WysiwygMediaSourceItem[];
    onOpenMediaSource: (id: string) => void;
    onOpenMediaUrl: (kind: WysiwygMediaKind) => void;
}) {
    const intl = useIntl();
    // The trigger lights up when the caret is inside something this menu owns,
    // so an author can see at a glance that the block editing under it applies
    // to where they are.
    const inserted = useLiveEditorState(
        editor,
        (instance) =>
            instance.isActive('table') ||
            instance.isActive('callout') ||
            instance.isActive('columnBlock') ||
            instance.isActive('image') ||
            instance.isActive('video'),
        false
    );

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <ToolbarMenuTrigger
                    label={intl.formatMessage(messages.label)}
                    icon={Plus}
                    active={inserted}
                />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
                {/* Media first: it is the block authors reach for most, and the
                    one with contributions behind it. */}
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                        <ImageIcon className="size-4" />
                        {intl.formatMessage(messages.media)}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                        <DropdownMenuSubContent className="w-56">
                            <MediaItems
                                sources={mediaSources}
                                onOpenSource={onOpenMediaSource}
                                onOpenUrl={onOpenMediaUrl}
                            />
                        </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                </DropdownMenuSub>

                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                        <TableIcon className="size-4" />
                        {intl.formatMessage(messages.table)}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                        <DropdownMenuSubContent className="w-52">
                            <TableItems editor={editor} />
                        </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                </DropdownMenuSub>

                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                        <Columns3 className="size-4" />
                        {intl.formatMessage(messages.columns)}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                        <DropdownMenuSubContent className="w-56">
                            <ColumnItems editor={editor} />
                        </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                </DropdownMenuSub>

                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                        <Info className="size-4" />
                        {intl.formatMessage(messages.callout)}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                        <DropdownMenuSubContent className="w-44">
                            <CalloutItems editor={editor} />
                        </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                </DropdownMenuSub>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                    onSelect={() =>
                        editor.chain().focus().setHorizontalRule().run()
                    }
                >
                    <Minus className="size-4" />
                    {intl.formatMessage(messages.divider)}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
