export { CopilotPlugin } from './lib/presentation/copilotPlugin';
export type { CopilotAdminPlugin } from './lib/presentation/copilotPlugin';

// The panel and its launcher, exported so a future entry point (the ⌘K
// palette, the entry editor) can mount the same surface rather than build a
// second one.
export { CopilotPanel } from './lib/presentation/CopilotPanel';
export type { CopilotPanelProps } from './lib/presentation/CopilotPanel';
export { CopilotLauncher } from './lib/presentation/CopilotLauncher';

// The full-page surface and the switch into it. Exported for the same reason
// the panel is: a deep link from elsewhere in the admin ("open this in Ortha
// AI") should reach the page that exists rather than build a second one.
export { AgentsPage } from './lib/presentation/AgentsPage';
export { ViewSwitcher } from './lib/presentation/ViewSwitcher';
export {
    AGENTS_SEGMENT,
    COPILOT_USE,
    agentsPath,
    agentThreadPath,
    isAgentsPath,
    readAgentThreadId
} from './lib/domain/agentsRoute';

// The transport and the chat state, exported for the same reason: an inline
// surface reuses the run stream instead of reimplementing SSE over fetch.
export { streamRun, CopilotRunError } from './lib/application/runStream';
export type {
    StartRunRequest,
    StartRunOptions
} from './lib/application/runStream';
export { useCopilotChat } from './lib/application/useCopilotChat';
export type { CopilotChat } from './lib/application/useCopilotChat';
// The chats themselves. Exported so a future surface can show one without
// owning it — which is the whole reason they live outside React.
export {
    copilotStoreState,
    subscribeToCopilotStore,
    resetCopilotStore
} from './lib/application/copilotStore';
export type { CopilotStoreState } from './lib/application/copilotStore';
export { useCopilotSessions } from './lib/application/useCopilotSessions';
export type { CopilotSessions } from './lib/application/useCopilotSessions';
export type { CopilotSession } from './lib/application/sessions';
export {
    useConversations,
    conversationsKey,
    conversationsScopeKey
} from './lib/application/useConversations';
export type { CopilotConversation } from './lib/application/useConversations';
export { useUpdateConversation } from './lib/application/useUpdateConversation';
export type { ConversationPatch } from './lib/application/useUpdateConversation';
export {
    useCopilotModels,
    copilotModelsKey,
    modelChoiceKey,
    parseModelChoiceKey
} from './lib/application/useCopilotModels';
export type {
    CopilotModelChoice,
    CopilotModelCatalogue
} from './lib/application/useCopilotModels';
export { ModelPicker } from './lib/presentation/ModelPicker';
export type {
    ChatMessage,
    ChatProposal,
    ChatToolStep
} from './lib/domain/types/chat';

// The receipt for a change the copilot made. Exported for the same reason the
// chat state is: a future inline surface (the entry editor's "suggest alt
// text") renders the same card rather than inventing a second way to tell
// someone their content changed.
// The tool-result slot: a plugin that owns a tool owns how its result reads.
// Every call still expands to its exact input and output — a contribution
// renders beside that payload, never instead of it.
export {
    COPILOT_TOOL_RESULT_SLOT,
    toolResultRendererFor
} from './lib/presentation/slots/copilotSlots';
export type {
    CopilotToolResultItem,
    CopilotToolResultContext
} from './lib/presentation/slots/copilotSlots';

export { ProposalCard } from './lib/presentation/ProposalCard';
// Where the user is, derived from the URL. Exported so a future inline surface
// (the ⌘K palette, an entry-editor widget) reports the same context rather than
// inventing its own.
export { useRouteContext } from './lib/application/useRouteContext';
export { readRouteContext } from './lib/application/readRouteContext';
export type { RouteContext } from './lib/application/readRouteContext';
