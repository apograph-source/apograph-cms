import { defineMessages, useIntl, type MessageDescriptor } from 'react-intl';
import { ArrowUpRight } from 'lucide-react';
import { HoneycombBackdrop } from './HoneycombBackdrop';

// The product is **Ortha AI**; the code keeps `copilot`. See the naming note in
// `docs/design/copilot.md`.
const messages = defineMessages({
    title: {
        id: 'copilot.agents.welcome.title',
        defaultMessage: 'What can I help you with in {workspace}?'
    },
    subtitle: {
        id: 'copilot.agents.welcome.subtitle',
        defaultMessage:
            'Ortha AI can only see and change what your own role allows. Every change it makes is recorded.'
    },
    suggestions: {
        id: 'copilot.agents.welcome.suggestions',
        defaultMessage: 'Try one of these'
    },
    types: {
        id: 'copilot.agents.welcome.types',
        defaultMessage: 'What content types can I work with here?'
    },
    recent: {
        id: 'copilot.agents.welcome.recent',
        defaultMessage: 'Summarise what changed in this workspace this week'
    },
    audit: {
        id: 'copilot.agents.welcome.audit',
        defaultMessage: 'Find published entries that are missing a description'
    },
    draft: {
        id: 'copilot.agents.welcome.draft',
        defaultMessage:
            'Draft a new entry and show me the change before I keep it'
    }
});

/**
 * The four openers.
 *
 * Each one maps onto a tool the copilot actually has — the content-type
 * catalogue, the activity feed, entry search, and the propose-a-change path. A
 * suggestion chip is a promise about what the assistant can do, and one that
 * lands on "I can't do that" is worse than an empty screen.
 */
const SUGGESTIONS: MessageDescriptor[] = [
    messages.types,
    messages.recent,
    messages.audit,
    messages.draft
];

export interface AgentsWelcomeProps {
    /** Named in the greeting, so it is obvious which workspace is in scope. */
    workspaceName: string;
    /** Sends a suggestion as the first turn. */
    onPick(text: string): void;
}

/**
 * The empty thread: a greeting and four things worth asking.
 *
 * It stands in for {@link MessageList}'s own empty state rather than sitting
 * above it, because a full page has room to *offer* something and a 420px panel
 * does not. The suggestions are the answer to the blank-composer problem — the
 * hard part of a copilot is not typing, it is knowing what it can be asked.
 */
export function AgentsWelcome({ workspaceName, onPick }: AgentsWelcomeProps) {
    const intl = useIntl();

    return (
        // `relative` + `overflow-hidden` so the lattice is clipped to this
        // panel rather than bleeding under the composer below it.
        <div className="relative flex flex-1 items-center justify-center overflow-hidden px-6 py-10">
            <HoneycombBackdrop />

            {/* Above the backdrop. Without the stacking context the greeting
                would be painted under it at these opacities — invisible, but
                only just. */}
            <div className="relative w-full max-w-2xl">
                <div className="flex flex-col items-center text-center">
                    {/* No mark above the greeting. It was a hexagon cut from the
                        lattice's own shape, and it was still one more thing to
                        read before the question it sat on top of — the lattice
                        already carries the motif. */}
                    <h2 className="text-2xl font-semibold tracking-tight text-balance">
                        {intl.formatMessage(messages.title, {
                            workspace: workspaceName
                        })}
                    </h2>
                    <p className="text-muted-foreground mt-2 max-w-md text-sm text-pretty">
                        {intl.formatMessage(messages.subtitle)}
                    </p>
                </div>

                <h3 className="text-muted-foreground mt-9 mb-2.5 text-[10px] font-semibold tracking-[0.08em] uppercase">
                    {intl.formatMessage(messages.suggestions)}
                </h3>
                {/* Buttons, not links or cards: picking one *sends a message*,
                    which is an action on this page and not a destination. */}
                <ul className="grid gap-2 sm:grid-cols-2">
                    {SUGGESTIONS.map((suggestion) => {
                        const text = intl.formatMessage(suggestion);
                        return (
                            <li key={suggestion.id}>
                                <button
                                    type="button"
                                    onClick={() => onPick(text)}
                                    className="bg-card hover:border-muted-foreground/40 hover:bg-accent/40 focus-visible:ring-ring group flex h-full w-full items-start gap-2 rounded-xl border px-3.5 py-3 text-left text-sm shadow-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
                                >
                                    <span className="flex-1 text-pretty">
                                        {text}
                                    </span>
                                    <ArrowUpRight
                                        className="text-muted-foreground mt-0.5 size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                                        aria-hidden
                                    />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
}
