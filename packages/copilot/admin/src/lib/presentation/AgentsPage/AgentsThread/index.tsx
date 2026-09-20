import { useRef } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { CircleAlert } from 'lucide-react';
import {
    Alert,
    AlertDescription,
    AlertTitle,
    Button,
    Skeleton,
    SkeletonRegion
} from '@orthacms/design-system';
import { useAgentThread } from '../../../application/useAgentThread';
import { useHasPermission } from '@orthacms/identity-admin';
import { MEDIA_CREATE } from '../../../domain/agentsRoute';
import { useComposerAttachments } from '../../../application/useComposerAttachments';
import { useComposerSkills } from '../../../application/useComposerSkills';
import { useEffectiveModelChoice } from '../../../application/useCopilotModels';
import type { RouteContext } from '../../../application/readRouteContext';
import { Composer } from '../../Composer';
import { ContextChip } from '../../ContextChip';
import { MessageList } from '../../MessageList';
import { ModelPicker } from '../../ModelPicker';
import { AgentsWelcome } from '../AgentsWelcome';

const messages = defineMessages({
    loadingThread: {
        id: 'copilot.agents.thread.loading',
        defaultMessage: 'Loading conversation…'
    },
    failedTitle: {
        id: 'copilot.agents.thread.failedTitle',
        defaultMessage: 'Could not open this chat'
    },
    failedBody: {
        id: 'copilot.agents.thread.failedBody',
        defaultMessage:
            'The chat may have been removed, or the server could not be reached.'
    },
    retry: {
        id: 'copilot.agents.thread.retry',
        defaultMessage: 'Try again'
    }
});

export interface AgentsThreadProps {
    /** The workspace runs are scoped to. */
    workspaceId: string;
    /** Named in the empty state, so the scope of the chat is never in doubt. */
    workspaceName: string;
    /**
     * Where the user is, from the URL. Offered above the composer so a question
     * can be pinned to the page they were last on — see {@link ContextChip}.
     */
    routeContext: RouteContext;
}

/**
 * The conversation column: what was said, and the box to say the next thing in.
 *
 * It is deliberately the **same** transcript, composer, tool steps, permission
 * prompts and change cards the docked panel renders. Two chat surfaces that
 * diverge is two chat surfaces to keep correct, and the parts worth getting
 * right — a permission prompt rendered inline rather than as a modal, a proposal
 * card attached to the turn that produced it — are exactly the parts that must
 * not be reimplemented at a larger size.
 */
export function AgentsThread({
    workspaceId,
    workspaceName,
    routeContext
}: AgentsThreadProps) {
    const intl = useIntl();
    const composerRef = useRef<HTMLTextAreaElement>(null);
    const {
        chat,
        loading,
        failed,
        retry,
        choice,
        setChoice,
        context: attached,
        setContext: setAttached,
        skills: stagedSkills,
        setSkills
    } = useAgentThread(workspaceId);
    // The backend the picker shows and the turn is sent with — the chat's own
    // pick, or the catalogue's first entry until there is one. Opening this
    // view therefore lands on a real model rather than on "Default".
    const model = useEffectiveModelChoice(choice);
    // Files staged for the next turn. Held here rather than inside `Composer`
    // so `send` can read what was staged and clear it once the turn is away.
    const files = useComposerAttachments();
    // Attaching a file is an ordinary `POST /api/media/assets` on the user's
    // own session, so the permission that matters is `media:create` — which
    // `viewer` does not hold. Without the gate the paperclip is offered to
    // someone whose every upload 403s, against the composer's own rule that a
    // surface with no library "renders no attach control at all … rather than
    // offering a button that fails".
    const canAttach = useHasPermission(MEDIA_CREATE);

    // Skills, likewise — except the selection lives on the chat rather than in
    // this component, so it survives leaving the page.
    const skills = useComposerSkills(workspaceId, stagedSkills, setSkills);

    // Opt-in, and a snapshot rather than a live mirror of the URL: an attached
    // context should not silently change under the user as they navigate. On
    // the **chat**, not in this component — this column unmounts when you leave
    // the Agents view or switch threads, and holding it here meant a question
    // asked after a trip into the CMS went with no context at all.

    const send = (text: string) => {
        chat.sendWith({
            text,
            context: {
                // Nothing attached means a plain chat turn — the model is told
                // where the user is only when they said so.
                surface: attached?.surface ?? 'chat',
                ...(attached?.contentType
                    ? { contentType: attached.contentType }
                    : {}),
                ...(attached?.entryId ? { entryId: attached.entryId } : {}),
                ...(attached?.locale ? { locale: attached.locale } : {})
            },
            options: {
                provider: model?.provider ?? null,
                model: model?.model ?? null
            },
            attachments: files.sent,
            skills: skills.inForce,
            chosenSkills: skills.chosen
        });
        // Cleared on send, not on the run finishing: the files belong to the
        // turn that was just sent, and leaving them staged would silently
        // attach them to the next question too.
        files.clear();
        // Skills are deliberately **not** cleared. A file belongs to the
        // message it was attached to; a skill is the mode you are working in,
        // and re-picking "house style" before every message is the friction
        // that makes people stop using the feature. The chips stay on screen,
        // so it is never a hidden state.
    };

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {failed ? (
                <div className="px-4 py-6">
                    <Alert
                        variant="destructive"
                        className="mx-auto w-full max-w-3xl"
                    >
                        <CircleAlert className="size-4" />
                        <AlertTitle>
                            {intl.formatMessage(messages.failedTitle)}
                        </AlertTitle>
                        <AlertDescription className="flex flex-col items-start gap-2">
                            {intl.formatMessage(messages.failedBody)}
                            <Button variant="outline" size="sm" onClick={retry}>
                                {intl.formatMessage(messages.retry)}
                            </Button>
                        </AlertDescription>
                    </Alert>
                </div>
            ) : loading ? (
                // A skeleton of the *shape* a transcript has — one right-aligned
                // question, an answer under it — rather than a spinner, so the
                // page does not change size the instant the thread lands.
                // Announced, not just drawn. The skeleton is correctly
                // `aria-hidden` and nothing replaced it, so opening a thread was
                // silent until the transcript landed — and "Thinking…" could not
                // stand in for it, because it lives inside the transcript that
                // has not arrived (`ORT-116`).
                <SkeletonRegion
                    label={intl.formatMessage(messages.loadingThread)}
                    className="flex-1 px-4 py-6"
                >
                    <div className="mx-auto w-full max-w-3xl space-y-3">
                        <Skeleton className="ml-auto h-9 w-1/2 rounded-lg" />
                        <Skeleton className="h-4 w-11/12" />
                        <Skeleton className="h-4 w-9/12" />
                        <Skeleton className="h-4 w-10/12" />
                    </div>
                </SkeletonRegion>
            ) : chat.messages.length === 0 ? (
                <AgentsWelcome
                    workspaceName={workspaceName}
                    onPick={(text) => {
                        send(text);
                        composerRef.current?.focus();
                    }}
                />
            ) : (
                <MessageList
                    messages={chat.messages}
                    onAnswer={chat.answer}
                    onExtend={chat.extendAnswer}
                />
            )}

            {/* The gutter goes on the outside and the column on the inside —
                the same nesting `MessageList` uses — so the composer measures
                the same 3xl as the messages above it. Padding *inside* the cap
                made the box 32px narrower than the transcript at any width past
                the cap, and the two edges visibly failed to line up. */}
            <div className="shrink-0 px-4 pt-2 pb-4">
                <div className="mx-auto w-full max-w-3xl">
                    {/* "Your message, plus where you are" (design §2) — but only
                        when the user asked for it. See ContextChip for why it is
                        opt-in. */}
                    <ContextChip
                        current={routeContext}
                        attached={attached}
                        onAttach={() => setAttached(routeContext)}
                        onDetach={() => setAttached(null)}
                        // The column is already padded here, so the chip
                        // contributes no gutter of its own.
                        className="px-0"
                    />
                    <Composer
                        busy={chat.busy}
                        inputRef={composerRef}
                        // In the box, bottom-left: the model applies to the
                        // turn being written, not to the conversation, so it
                        // belongs with the thing that writes it.
                        controls={
                            <ModelPicker value={model} onChange={setChoice} />
                        }
                        // The page already centres and pads its own column, so
                        // the composer drops the panel's divider and gutters
                        // and contributes only the box itself.
                        className="border-t-0 p-0"
                        onSend={send}
                        onStop={chat.stop}
                        {...(canAttach ? { attachments: files } : {})}
                        skills={skills}
                    />
                </div>
            </div>
        </div>
    );
}
