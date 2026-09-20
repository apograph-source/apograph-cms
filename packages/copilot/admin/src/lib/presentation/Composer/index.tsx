import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ClipboardEvent,
    type DragEvent,
    type KeyboardEvent,
    type ReactNode
} from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { ArrowUp, Paperclip, Square } from 'lucide-react';
import { Button, Textarea, cn } from '@orthacms/design-system';
import { AttachmentChip } from '../AttachmentChip';
import { SkillChip } from '../SkillChip';
import { SkillPicker } from '../SkillPicker';
import type { ComposerAttachments } from '../../application/useComposerAttachments';
import type { ComposerSkills } from '../../application/useComposerSkills';

const messages = defineMessages({
    hintLabel: {
        id: 'copilot.composer.hintLabel',
        defaultMessage: 'Composer status'
    },
    placeholder: {
        id: 'copilot.composer.placeholder',
        defaultMessage: 'Ask about your content…'
    },
    send: {
        id: 'copilot.composer.send',
        defaultMessage: 'Send'
    },
    stop: {
        id: 'copilot.composer.stop',
        defaultMessage: 'Stop'
    },
    hint: {
        id: 'copilot.composer.hint',
        defaultMessage: 'Enter to send, Shift+Enter for a new line'
    },
    attach: {
        id: 'copilot.composer.attach',
        defaultMessage: 'Attach files'
    },
    dropHere: {
        id: 'copilot.composer.dropHere',
        defaultMessage: 'Drop files to attach them'
    },
    // Deliberately NOT "Attached files" — that is what the *sent* list on a
    // turn is called, and two lists in one view answering to one name leaves a
    // screen-reader user unable to tell a file they are still staging from one
    // already on its way. (Found by the e2e suite resolving the wrong list.)
    attachedFiles: {
        id: 'copilot.composer.attachedFiles',
        defaultMessage: 'Files to send'
    },
    // Its own name for the same reason: two chip lists in one box answering to
    // one label leaves a screen-reader user unable to tell a file from a skill.
    stagedSkills: {
        id: 'copilot.composer.stagedSkills',
        defaultMessage: 'Skills for this chat'
    },
    uploadingHint: {
        id: 'copilot.composer.uploadingHint',
        defaultMessage: 'Waiting for uploads to finish…'
    },
    // Pressing Enter mid-answer used to do nothing at all: the box kept the
    // text (correctly — losing it would be worse) and nothing said why it had
    // not gone. Someone who did not notice the button had become Stop reads
    // that as the app having missed the keystroke, and presses Enter again.
    busyHint: {
        id: 'copilot.composer.busyHint',
        defaultMessage:
            'Still answering — wait for it to finish, or press Stop to send this now.'
    }
});

/**
 * How tall the box may grow before it scrolls, in px — about six lines.
 *
 * A composer that grows without a ceiling eats the transcript it is a reply to;
 * one that never grows hides the paragraph you are still editing behind two
 * visible lines. Six is enough to see a long question whole and little enough
 * that the answer above stays on screen.
 */
const MAX_HEIGHT = 152;

export interface ComposerProps {
    /** True while a run is in flight — the button becomes Stop. */
    busy: boolean;
    /** Sends the typed message. */
    onSend(text: string): void;
    /**
     * Staged attachments, when the surface supports them. Omit and the
     * composer renders no attach control at all — which is what a surface
     * without a media library should do, rather than offer a button that fails.
     */
    attachments?: ComposerAttachments;
    /**
     * The workspace's skills and what is staged from them. Omit and the
     * composer renders no skills control — the same discipline as
     * `attachments`, and what keeps a surface with no catalogue from offering a
     * button that opens an empty list.
     */
    skills?: ComposerSkills;
    /** Cancels the run in flight. */
    onStop(): void;
    /**
     * The textarea, so a surface can focus it on open. A ref rather than
     * `autoFocus`: the panel is **non-modal**, and `autoFocus` would also steal
     * focus on any remount (a resize, a workspace switch) while someone is
     * typing somewhere else on the page.
     */
    inputRef?: React.Ref<HTMLTextAreaElement>;
    /**
     * Controls for the box's bottom-left — the model picker, and whatever else
     * belongs to composing the *next* turn rather than to the thread. They sit
     * inside the box because that is what they act on; putting them in a page
     * header states them as a property of the conversation, which the model
     * choice is not (it applies per turn).
     */
    controls?: ReactNode;
    /**
     * Overrides the wrapper's chrome. The panel wants the divider and padding
     * that separate it from the transcript above; a page that already centres
     * its own column wants neither.
     */
    className?: string;
}

/**
 * The message box: a bordered field with the send button and any per-turn
 * controls on a row along its bottom.
 *
 * Enter sends and Shift+Enter inserts a newline, which is the convention every
 * chat surface uses. IME composition is checked explicitly: mid-composition
 * Enter commits a candidate rather than meaning "send", and without the guard
 * anyone typing Japanese, Chinese or Korean would send a half-finished word.
 *
 * **The field grows with what you type, up to {@link MAX_HEIGHT}.** A fixed two
 * rows is fine for "how many authors are there?" and wrong for the paragraph of
 * context that makes a question answerable — you end up editing through a
 * letterbox. Growth is measured rather than counted (`scrollHeight` after
 * collapsing to `auto`), so a wrapped line costs the same as a typed newline.
 */
export function Composer({
    busy,
    onSend,
    onStop,
    inputRef,
    controls,
    className,
    attachments,
    skills
}: ComposerProps) {
    const intl = useIntl();
    const [value, setValue] = useState('');
    const [dragging, setDragging] = useState(false);
    const fieldRef = useRef<HTMLTextAreaElement | null>(null);
    const fileRef = useRef<HTMLInputElement | null>(null);
    // Drag events fire per element, so entering a child fires `dragleave` on
    // the parent. Counting keeps the highlight on until the pointer has really
    // left the box, instead of flickering across every child it crosses.
    const dragDepth = useRef(0);

    // The caller may want the field too (the page focuses it on mount), and an
    // element has one `ref` — so this fans the node out to both.
    const attachField = useCallback(
        (node: HTMLTextAreaElement | null) => {
            fieldRef.current = node;
            if (typeof inputRef === 'function') {
                inputRef(node);
            } else if (inputRef) {
                (
                    inputRef as React.MutableRefObject<HTMLTextAreaElement | null>
                ).current = node;
            }
        },
        [inputRef]
    );

    // Before paint, not after: measuring in `useEffect` lets the browser show
    // one frame at the old height, which reads as a flicker on every keystroke
    // that wraps a line. Collapsing to `auto` first is what lets it *shrink*
    // again when text is deleted — `scrollHeight` never reports less than the
    // height already set.
    useLayoutEffect(() => {
        const field = fieldRef.current;
        if (!field) {
            return;
        }
        field.style.height = 'auto';
        field.style.height = `${Math.min(field.scrollHeight, MAX_HEIGHT)}px`;
    }, [value]);

    // Set when the last Enter/Send was refused because a run was still in
    // flight. Cleared by the run ending, so the notice never outlives the state
    // that caused it.
    const [refused, setRefused] = useState(false);
    useEffect(() => {
        if (!busy) {
            setRefused(false);
        }
    }, [busy]);

    // Blocked while an upload is in flight: sending now would drop the file
    // from the turn silently, and the person has no way to know the difference
    // between "attached" and "still uploading" once the message is gone.
    const blocked = busy || attachments?.uploading === true;

    const submit = () => {
        const text = value.trim();
        if (!text) {
            return;
        }
        if (blocked) {
            // Say so rather than swallow it. The hint line below is already the
            // live region for "the reason your send did not happen" — the
            // upload wait and the attachment-count refusal both speak through
            // it — so a run in flight belongs there too. `uploading` keeps its
            // own more specific line.
            setRefused(busy);
            return;
        }
        setRefused(false);
        onSend(text);
        setValue('');
    };

    const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
        // Only when the clipboard actually carries files. A normal text paste
        // has an empty `files`, and intercepting it would break paste.
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length > 0 && attachments) {
            event.preventDefault();
            attachments.add(files);
        }
    };

    const onDrop = (event: DragEvent<HTMLDivElement>) => {
        setDragging(false);
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length > 0 && attachments) {
            event.preventDefault();
            attachments.add(files);
        }
    };

    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key !== 'Enter' || event.shiftKey) {
            return;
        }
        if (event.nativeEvent.isComposing) {
            return;
        }
        event.preventDefault();
        submit();
    };

    return (
        <div
            className={cn(
                // `px-4`, matching the transcript's scroller: the box and the
                // messages above it are one column, and a 4px step between them
                // reads as a wobble down the panel's edge. `py-3` keeps the
                // vertical rhythm the divider was drawn for.
                'border-border/60 relative border-t px-4 py-3',
                className
            )}
            onDragEnter={(event) => {
                if (!attachments || !hasFiles(event)) {
                    return;
                }
                dragDepth.current += 1;
                setDragging(true);
            }}
            onDragOver={(event) => {
                // Without this the browser navigates to the dropped file, and
                // the drop handler never runs.
                if (attachments && hasFiles(event)) {
                    event.preventDefault();
                }
            }}
            onDragLeave={() => {
                dragDepth.current = Math.max(dragDepth.current - 1, 0);
                if (dragDepth.current === 0) {
                    setDragging(false);
                }
            }}
            onDrop={(event) => {
                dragDepth.current = 0;
                onDrop(event);
            }}
        >
            {dragging ? (
                <div className="border-primary bg-primary/5 text-primary pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-lg border-2 border-dashed text-xs font-medium">
                    {intl.formatMessage(messages.dropHere)}
                </div>
            ) : null}
            {/* The border and the focus ring live on this wrapper rather than on
                the field, so the controls below read as part of one box. The
                field itself is stripped of both — two nested rings on focus is
                the giveaway that a composer was assembled rather than designed. */}
            <div className="border-input bg-card focus-within:border-primary focus-within:ring-primary/15 rounded-lg border shadow-xs transition-colors focus-within:ring-2">
                {/* Skills above the files, because they change how the whole
                    turn is answered while a file is one thing in it. */}
                {skills && skills.staged.length + skills.always.length > 0 ? (
                    <ul
                        className="flex flex-wrap gap-1.5 px-2 pt-2"
                        aria-label={intl.formatMessage(messages.stagedSkills)}
                    >
                        {skills.always.map((skill) => (
                            <li key={skill.name}>
                                <SkillChip title={skill.title} alwaysOn />
                            </li>
                        ))}
                        {skills.staged.map((skill) => (
                            <li key={skill.name}>
                                <SkillChip
                                    title={skill.title}
                                    onRemove={() => skills.remove(skill.name)}
                                />
                            </li>
                        ))}
                    </ul>
                ) : null}
                {attachments && attachments.items.length > 0 ? (
                    <ul
                        className="flex flex-wrap gap-1.5 px-2 pt-2"
                        aria-label={intl.formatMessage(messages.attachedFiles)}
                    >
                        {attachments.items.map((item) => (
                            <li key={item.id}>
                                <AttachmentChip
                                    name={item.name}
                                    size={item.size}
                                    {...(item.asset
                                        ? { kind: item.asset.kind }
                                        : {})}
                                    progress={item.progress}
                                    uploading={item.status === 'uploading'}
                                    failed={item.status === 'failed'}
                                    {...(item.error
                                        ? { error: item.error }
                                        : {})}
                                    onRemove={() => attachments.remove(item.id)}
                                />
                            </li>
                        ))}
                    </ul>
                ) : null}
                <Textarea
                    ref={attachField}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    onKeyDown={onKeyDown}
                    onPaste={onPaste}
                    placeholder={intl.formatMessage(messages.placeholder)}
                    aria-label={intl.formatMessage(messages.placeholder)}
                    rows={2}
                    className="min-h-0 resize-none overflow-y-auto border-0 bg-transparent px-3 py-2.5 shadow-none focus-visible:border-0 focus-visible:ring-0"
                />
                <div className="flex items-center justify-between gap-2 px-2 pb-2">
                    {/* Always rendered, even with no controls, so the send
                        button keeps its place instead of jumping when a
                        deployment offers one model and the picker hides. */}
                    <div className="flex min-w-0 items-center gap-1">
                        {attachments ? (
                            <>
                                <input
                                    ref={fileRef}
                                    type="file"
                                    multiple
                                    className="hidden"
                                    onChange={(event) => {
                                        if (event.target.files) {
                                            attachments.add(event.target.files);
                                        }
                                        // Cleared so picking the same file
                                        // twice in a row still fires `change`.
                                        event.target.value = '';
                                    }}
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-7 shrink-0"
                                    onClick={() => fileRef.current?.click()}
                                    aria-label={intl.formatMessage(
                                        messages.attach
                                    )}
                                >
                                    <Paperclip className="size-4" />
                                </Button>
                            </>
                        ) : null}
                        {skills ? (
                            <SkillPicker
                                skills={skills.all}
                                selected={skills.selected}
                                onChange={skills.setSelected}
                                max={skills.max}
                                loading={skills.loading}
                            />
                        ) : null}
                        {controls}
                    </div>
                    <Button
                        type="button"
                        size="icon"
                        className="size-7 shrink-0"
                        onClick={busy ? onStop : submit}
                        disabled={
                            !busy &&
                            (value.trim().length === 0 ||
                                attachments?.uploading === true)
                        }
                        aria-label={intl.formatMessage(
                            busy ? messages.stop : messages.send
                        )}
                    >
                        {busy ? (
                            <Square className="size-3.5" />
                        ) : (
                            <ArrowUp className="size-4" />
                        )}
                    </Button>
                </div>
            </div>
            <p
                className={cn(
                    'mt-1.5 text-[11px]',
                    attachments?.error || refused
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                )}
                // A live region so the count refusal and the upload wait are
                // announced, not just drawn — both are the reason a send did
                // not happen, which a screen-reader user otherwise meets as
                // silence.
                role="status"
                // Named, because it is no longer the only status region in the
                // view: `MessageList` added one for the run's phase (`ORT-116`).
                // Two unnamed live regions in one surface is precisely the
                // ambiguity that fix was about — a screen-reader user hears two
                // voices and cannot tell which is which.
                aria-label={intl.formatMessage(messages.hintLabel)}
            >
                {attachments?.error ??
                    (attachments?.uploading
                        ? intl.formatMessage(messages.uploadingHint)
                        : refused
                          ? intl.formatMessage(messages.busyHint)
                          : intl.formatMessage(messages.hint))}
            </p>
        </div>
    );
}

/** Whether a drag actually carries files, rather than selected text or a link. */
function hasFiles(event: DragEvent<HTMLDivElement>): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}
