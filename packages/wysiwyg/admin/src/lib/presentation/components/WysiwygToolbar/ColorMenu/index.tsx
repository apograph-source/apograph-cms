import { defineMessages, useIntl, type MessageDescriptor } from 'react-intl';
import type { Editor } from '@tiptap/react';
import { Baseline, Check, Highlighter } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    cn
} from '@orthacms/design-system';
import {
    HIGHLIGHT_COLORS,
    TEXT_COLORS,
    type SwatchOption
} from '../../../../domain/constants';
import { useLiveEditorState } from '../../../hooks/useLiveEditorState';
import { ToolbarMenuTrigger } from '../ToolbarMenuTrigger';

const messages = defineMessages({
    textLabel: { id: 'wysiwyg.color.textLabel', defaultMessage: 'Text color' },
    highlightLabel: {
        id: 'wysiwyg.color.highlightLabel',
        defaultMessage: 'Highlight'
    },
    clearText: {
        id: 'wysiwyg.color.clearText',
        defaultMessage: 'Default color'
    },
    clearHighlight: {
        id: 'wysiwyg.color.clearHighlight',
        defaultMessage: 'No highlight'
    },
    slate: { id: 'wysiwyg.color.slate', defaultMessage: 'Slate' },
    gray: { id: 'wysiwyg.color.gray', defaultMessage: 'Gray' },
    red: { id: 'wysiwyg.color.red', defaultMessage: 'Red' },
    orange: { id: 'wysiwyg.color.orange', defaultMessage: 'Orange' },
    amber: { id: 'wysiwyg.color.amber', defaultMessage: 'Amber' },
    yellow: { id: 'wysiwyg.color.yellow', defaultMessage: 'Yellow' },
    lime: { id: 'wysiwyg.color.lime', defaultMessage: 'Lime' },
    green: { id: 'wysiwyg.color.green', defaultMessage: 'Green' },
    teal: { id: 'wysiwyg.color.teal', defaultMessage: 'Teal' },
    cyan: { id: 'wysiwyg.color.cyan', defaultMessage: 'Cyan' },
    blue: { id: 'wysiwyg.color.blue', defaultMessage: 'Blue' },
    violet: { id: 'wysiwyg.color.violet', defaultMessage: 'Violet' },
    pink: { id: 'wysiwyg.color.pink', defaultMessage: 'Pink' }
});

/** Every color name either palette can hold, by the id the palette declares. */
const COLOR_NAMES: Record<string, MessageDescriptor> = {
    slate: messages.slate,
    gray: messages.gray,
    red: messages.red,
    orange: messages.orange,
    amber: messages.amber,
    yellow: messages.yellow,
    lime: messages.lime,
    green: messages.green,
    teal: messages.teal,
    cyan: messages.cyan,
    blue: messages.blue,
    violet: messages.violet,
    pink: messages.pink
};

/** Which of the two color marks this menu drives. */
export const COLOR_KIND = {
    /** The `textStyle` mark's `color` — the glyphs themselves. */
    Text: 'text',
    /** The `highlight` mark's `color` — the marker behind them. */
    Highlight: 'highlight'
} as const;

/** A {@link ColorMenu} target. */
export type ColorKind = (typeof COLOR_KIND)[keyof typeof COLOR_KIND];

/**
 * A color picker for one of the two color marks. One component for both because
 * they differ only in which mark they read and write — duplicating it would
 * mean two swatch grids, two keyboard models, and two chances to drift.
 *
 * Swatches are real menu items (arrow-key reachable) laid out in a grid, each
 * carrying its color **name** as its accessible name: a screen reader announces
 * "Amber", not `#b45309`, and the applied color is marked with a check rather
 * than by hue alone.
 */
export function ColorMenu({
    editor,
    kind
}: {
    editor: Editor;
    kind: ColorKind;
}) {
    const intl = useIntl();
    const isText = kind === COLOR_KIND.Text;
    const palette: readonly SwatchOption[] = isText
        ? TEXT_COLORS
        : HIGHLIGHT_COLORS;

    const current = useLiveEditorState(
        editor,
        (instance) => {
            const color = isText
                ? instance.getAttributes('textStyle')['color']
                : instance.getAttributes('highlight')['color'];
            return typeof color === 'string' ? color : undefined;
        },
        undefined
    );

    const pick = (value: string) => {
        if (isText) editor.chain().focus().setColor(value).run();
        else editor.chain().focus().setHighlight({ color: value }).run();
    };

    const clear = () => {
        if (isText) editor.chain().focus().unsetColor().run();
        else editor.chain().focus().unsetHighlight().run();
    };

    const label = intl.formatMessage(
        isText ? messages.textLabel : messages.highlightLabel
    );

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <ToolbarMenuTrigger
                    label={label}
                    icon={isText ? Baseline : Highlighter}
                    active={current !== undefined}
                />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
                <div
                    className="grid grid-cols-5 gap-1 p-1"
                    role="group"
                    aria-label={label}
                >
                    {palette.map((swatch) => {
                        const value = swatch.value as string;
                        const selected = current === value;
                        return (
                            <DropdownMenuItem
                                key={swatch.id}
                                className={cn(
                                    'flex size-9 items-center justify-center rounded-md p-0',
                                    selected && 'ring-2 ring-ring/50'
                                )}
                                onSelect={() => pick(value)}
                            >
                                <span
                                    className="flex size-6 items-center justify-center rounded-full border border-border/60"
                                    style={{ backgroundColor: value }}
                                >
                                    {selected ? (
                                        <Check
                                            className="size-3.5 text-white mix-blend-difference"
                                            aria-hidden
                                        />
                                    ) : null}
                                </span>
                                <span className="sr-only">
                                    {intl.formatMessage(COLOR_NAMES[swatch.id])}
                                </span>
                            </DropdownMenuItem>
                        );
                    })}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={clear}>
                    {intl.formatMessage(
                        isText ? messages.clearText : messages.clearHighlight
                    )}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
