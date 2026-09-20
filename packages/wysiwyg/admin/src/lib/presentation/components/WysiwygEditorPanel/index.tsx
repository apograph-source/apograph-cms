import { useEffect, useId, useRef } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { EditorContent, useEditor } from '@tiptap/react';
import {
    inspectRichText,
    type RichTextDocument
} from '@orthacms/content-domain';
import { Button } from '@orthacms/design-system';
import { WYSIWYG_PROSE_CLASS } from '../../../domain/constants';
import { normalizeRichText } from '../../../domain/richTextValue';
import { editorExtensions } from '../../../infrastructure/editorExtensions';
import { transformPastedHTML } from '../../../infrastructure/transformPastedHTML';
import { useLiveEditorState } from '../../hooks/useLiveEditorState';
import { WysiwygIssueList } from '../WysiwygIssueList';
import { WysiwygToolbar } from '../WysiwygToolbar';

const messages = defineMessages({
    editorLabel: {
        id: 'wysiwyg.editor.label',
        defaultMessage: '{field} content'
    },
    count: {
        id: 'wysiwyg.editor.count',
        defaultMessage:
            '{words, plural, one {# word} other {# words}} · {characters, plural, one {# character} other {# characters}}'
    },
    done: { id: 'wysiwyg.editor.done', defaultMessage: 'Done' },
    back: { id: 'wysiwyg.editor.back', defaultMessage: 'Back to fields' },
    escapeHint: {
        id: 'wysiwyg.editor.escapeHint',
        defaultMessage:
            'Press Control plus M to move focus out of the document, to the button that closes the editor.'
    }
});

/**
 * The chord that takes focus out of the document.
 *
 * Tab cannot be it. Inside a table `TableKit` binds Tab to "next cell", and at
 * the last cell it appends a **row** and moves into that. `TableTab` now bounds
 * that to a single row — a second Tab through the empty row it just made falls
 * through — but the first press still does not leave, and a nested list swallows
 * Tab outright (`sinkListItem`).
 * Shift-Tab does escape backwards, and Tab escapes from an ordinary paragraph,
 * but WCAG 2.1.2 asks that the user be *advised* of the way out, and nothing
 * said so — hence this, plus the visually-hidden instruction the surface points
 * at with `aria-describedby`.
 *
 * `Ctrl` and not `Mod`: on macOS `Mod` is ⌘, and ⌘M is "minimize window" —
 * taking it would break the OS. Ctrl+M is free on every platform, and is what
 * ARIA's authoring practices name for exactly this editor pattern.
 */
function isEscapeChord(event: KeyboardEvent): boolean {
    return (
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'm'
    );
}

/**
 * The editing surface itself: toolbar, document, footer. Expects a flex-column
 * parent that has already claimed its height — the body is the part that
 * scrolls, so the toolbar and the footer stay put while a long document moves
 * under them.
 *
 * Mounted **only while the field is expanded**, which is what lets the editor be
 * seeded from `initialContent` once at mount and own its state from then on — no
 * controlled-content sync, and therefore none of the caret-jumping that comes
 * with one.
 *
 * Edits are written straight back to the entry form as they're made, exactly
 * like typing in any other field. The record's own Save — still right there in
 * the top bar, since expanding swapped only the work area — stays the commit
 * boundary, so leaving this view never loses anything.
 */
export function WysiwygEditorPanel({
    fieldLabel,
    initialContent,
    placeholder,
    required = false,
    readOnly = false,
    onChange,
    onDone
}: {
    /** The field's display label, used to name the editing region. */
    fieldLabel: string;
    /**
     * The value when the field was expanded — the stored document, or the HTML
     * string a body written before this change is still stored as, which TipTap
     * parses through its own schema. Read once, not a controlled prop.
     */
    initialContent: RichTextDocument | string;
    /** The field's `admin.placeholder`, shown in an empty document. */
    placeholder: string;
    /** Mirrors the field's `required` onto the editing surface. */
    required?: boolean;
    /**
     * Render the document as a **reading** surface: no toolbar, no caret, no
     * writes. Used when the entry editor is read-only, where expanding a body is
     * still worth doing — a long document doesn't fit the collapsed preview's
     * clamp — but nothing about it may change.
     */
    readOnly?: boolean;
    /** Write an edit back to the entry form. */
    onChange: (value: RichTextDocument | null) => void;
    /** Collapse back to the form. */
    onDone: () => void;
}) {
    const intl = useIntl();

    // The form hands down a fresh `onChange` on every render. TipTap captures
    // its options when the editor is created, so calling the prop directly
    // would pin the editor to the first closure it ever saw; the ref keeps the
    // write pointed at the current one.
    const onChangeRef = useRef(onChange);
    useEffect(() => {
        onChangeRef.current = onChange;
    });

    /** The nearest way out of the document — the footer's own exit button. */
    const exitRef = useRef<HTMLButtonElement>(null);
    const hintId = useId();

    const editor = useEditor({
        extensions: editorExtensions(placeholder),
        content: initialContent,
        editable: !readOnly,
        // The author pressed the field to keep writing, so start where the text
        // ends — and put focus in the document rather than leaving it on the
        // control that just disappeared. A reader has nothing to type into, and
        // dropping them at the *end* of a document they came to read is the
        // opposite of useful — so focus is left alone in that case.
        autofocus: readOnly ? false : 'end',
        editorProps: {
            attributes: {
                class: `${WYSIWYG_PROSE_CLASS} outline-none`,
                // A bare `contenteditable` div has no role, so assistive tech
                // is left to guess it's editable at all. `textbox` +
                // `aria-multiline` is the mapping ProseMirror doesn't apply for
                // us, and the label keeps it distinct from the entry form's own
                // inputs (there can be several rich-text fields on one record).
                //
                // None of that applies once the surface isn't editable: a
                // `textbox` that takes no text misdescribes it, and `required`
                // is meaningless on something the reader can't fill. It reads as
                // a labelled `region` instead — a passage of the page, which is
                // what it now is.
                ...(readOnly
                    ? { role: 'region' }
                    : {
                          role: 'textbox',
                          'aria-multiline': 'true',
                          'aria-required': String(required),
                          // Only the writing surface advertises the escape
                          // chord: a reader's surface takes no keystrokes, has
                          // no toolbar in front of it, and Tab already leaves
                          // it in one press.
                          'aria-describedby': hintId
                      }),
                'aria-label': intl.formatMessage(messages.editorLabel, {
                    field: fieldLabel
                })
            },
            handleKeyDown: (_view, event) => {
                if (readOnly || !isEscapeChord(event)) return false;
                event.preventDefault();
                exitRef.current?.focus();
                return true;
            },
            // Strips the source app's colour and font-size out of a paste, so
            // Word's and Google Docs' typography does not ride into the
            // published body — see `transformPastedHTML` (`ORT-164`).
            transformPastedHTML
        },
        onUpdate: ({ editor: instance }) => {
            // Belt-and-braces: `editable: false` already refuses every
            // transaction, but this is the one line that writes to the record.
            if (readOnly) return;
            // `getJSON`, not `getHTML`: the stored value is the **document**,
            // which is what makes its heading order, table headers and language
            // markers checkable instead of characters in an opaque string.
            // Saving one is also how a legacy HTML body is upgraded — it was
            // parsed through this editor's schema on the way in.
            onChangeRef.current(
                normalizeRichText(instance.getJSON() as RichTextDocument)
            );
        }
    });

    /** The document's live word/character totals, read off the editor. */
    const readCounts = (instance: typeof editor) => {
        const count = instance.storage['characterCount'] as {
            words: () => number;
            characters: () => number;
        };
        return { words: count.words(), characters: count.characters() };
    };

    // The structural findings on the document as it stands — the same rules the
    // server applies (`inspectRichText`), read live so an author is told while
    // they can still act on it rather than by a failed save. 504.2 asks whether
    // the tool *enables* conformant content; a rule nobody sees until the gate
    // closes does not.
    const issues = useLiveEditorState(
        editor,
        (instance) => inspectRichText(instance.getJSON()),
        []
    );

    const live = useLiveEditorState(editor, readCounts, {
        words: 0,
        characters: 0
    });

    // `useEditorState` refreshes its snapshot on the editor's `transaction` /
    // `update` events and nothing else, and its **first** snapshot is taken
    // before the initial content has settled — so the counts only become right
    // once some transaction fires. While editing, `autofocus: 'end'` fires one
    // on mount and every keystroke fires more, so that was invisible.
    //
    // A read-only editor has neither: no autofocus, and `editable: false`
    // refuses every transaction. The subscription would sit on that first empty
    // snapshot forever and the footer would read "0 words · 0 characters" over a
    // full document. Nothing can change those totals here, so read them straight
    // off the editor instead of waiting for an event that will never arrive.
    const counts = readOnly && !editor.isDestroyed ? readCounts(editor) : live;

    return (
        <>
            {/* The toolbar is nothing but commands that write, so in a
                read-only view it is dropped whole rather than mounted with
                twenty inert controls. */}
            {readOnly ? null : <WysiwygToolbar editor={editor} />}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <EditorContent editor={editor} />
                {/* The surface's `aria-describedby` target. Visually hidden
                    because it is advice for someone who cannot see that the
                    exit button is right below the document — everyone else can
                    just look at it. */}
                {readOnly ? null : (
                    <p id={hintId} className="sr-only">
                        {intl.formatMessage(messages.escapeHint)}
                    </p>
                )}
            </div>
            {/* Below the document rather than above it: the findings are about
                what has been written, and a list that pushed the writing
                surface down every time a heading changed would move the caret
                out from under the author's eyes. A reader gets it too — a
                read-only body they cannot fix is still a body whose problems
                are worth knowing, and this is the only surface that says so. */}
            <WysiwygIssueList issues={issues} />
            <div className="flex items-center justify-between gap-4 border-t border-border px-6 py-3">
                <p
                    className="text-xs text-muted-foreground"
                    // The count changes on every keystroke; announcing each one
                    // would talk over the author as they write.
                    aria-live="off"
                >
                    {intl.formatMessage(messages.count, counts)}
                </p>
                {/* "Done" is the end of an editing session — the wrong word for
                    a reader, who has nothing to finish. It does the same thing
                    either way (collapse back to the form), so in preview it just
                    says so, matching the link at the top of the view. */}
                <Button ref={exitRef} type="button" onClick={onDone}>
                    {intl.formatMessage(
                        readOnly ? messages.back : messages.done
                    )}
                </Button>
            </div>
        </>
    );
}
