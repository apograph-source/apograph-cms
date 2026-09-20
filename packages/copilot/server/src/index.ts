export { CopilotPlugin } from './lib/utils/copilot-plugin';
export type {
    CopilotPluginOptions,
    CopilotServerPluginDefinition
} from './lib/utils/copilot-plugin';
export { CopilotModule } from './lib/copilot.module';
export type { CopilotModuleOptions } from './lib/copilot.module';
export {
    COPILOT_CONFIG,
    COPILOT_RUN_LIMITS,
    COPILOT_SKILL_REGISTRY,
    InjectCopilotConfig
} from './lib/copilot.tokens';
export type { CopilotPluginConfig } from './lib/types/copilot-config';
export { buildModelRegistry } from './lib/infrastructure/model-registry';
export type { ProviderRegistration } from './lib/infrastructure/model-registry';

// Tools are no longer registered here. A binding plugin registers with the
// shared `ToolRegistry` from `@orthacms/tools-server` — the same catalogue the
// MCP endpoint serves — and marks a copilot-only tool `surfaces: ['copilot']`
// (ADR-0006 §2).
export { ProposalApplierRegistry } from './lib/chat/application/proposal-applier.registry';
// The sibling one-liner for the plugins that own writes. A plugin binding
// propose tools must register the appliers for the kinds they produce.
export { copilotAppliersRegistrar } from './lib/chat/application/appliers-registrar';

// The run engine and its collaborators, exported for tests and for a future
// non-HTTP surface (a job runner in phase 5) that needs the loop without the
// controller.
export {
    RunEngine,
    CopilotDisabledError,
    UnknownModelChoiceError
} from './lib/chat/application/run-engine.service';
export type { StartRunInput } from './lib/chat/application/run-engine.service';
export { CapabilityProfileService } from './lib/chat/application/capability-profile.service';
export { ConversationRepository } from './lib/chat/infrastructure/persistence/conversation.repository';
export type {
    ConversationView,
    MessageView,
    ToolCallRecord
} from './lib/chat/infrastructure/persistence/conversation.repository';
export {
    buildSystemPrompt,
    SYSTEM_PROMPT_VERSION
} from './lib/chat/application/system-prompt';
export type {
    SurfaceContext,
    SystemPromptInput
} from './lib/chat/application/system-prompt';

// --- skills ---
export {
    SkillCatalogService,
    SkillResolutionError
} from './lib/skills/application/skill-catalog.service';
export type { SkillSummary } from './lib/skills/application/skill-catalog.service';
export { SkillRepository } from './lib/skills/infrastructure/persistence/skill.repository';
export type { SkillRecord } from './lib/skills/infrastructure/persistence/skill.repository';

// The Drizzle tables this plugin owns and migrates.
export * from './lib/chat/infrastructure/schema';
export * from './lib/skills/infrastructure/schema';
export { proposalEventActor } from './lib/chat/application/proposal-event-actor';
