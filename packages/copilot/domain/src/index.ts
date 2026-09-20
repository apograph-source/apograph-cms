export type {
    JsonSchema,
    ModelTool,
    TextBlock,
    ToolUseBlock,
    ToolResultBlock,
    ModelContentBlock,
    ModelMessage
} from './lib/model/model-message';
export type { ModelCapabilities } from './lib/model/model-capabilities';
export {
    SUPPORTED_BASELINE,
    baselineShortfalls,
    meetsSupportedBaseline
} from './lib/model/model-capabilities';
export type { BaselineShortfall } from './lib/model/model-capabilities';
export type {
    ModelRequest,
    ModelChoice,
    ModelUsage,
    ModelStopReason,
    TextDeltaEvent,
    ToolCallEvent,
    DoneEvent,
    ModelStreamEvent,
    ModelProvider,
    ModelRunContext,
    ModelRegistry,
    ModelResolver
} from './lib/model/model-provider';
export { MODEL_REGISTRY, MODEL_RESOLVER } from './lib/model/model-provider';
export { isAbortError, abortedEvent } from './lib/model/abort';
export { resolveModel } from './lib/model/resolve-model';
export { normalizeTranscript } from './lib/model/transcript';
// The port's conformance kit. Framework-free on purpose: it reports rather than
// asserts, so it needs no test runner and this package still imports nothing.
export {
    MODEL_PROVIDER_CONFORMANCE_CHECKS,
    runModelProviderConformance
} from './lib/model/conformance';
export type {
    ModelProviderConformanceCase,
    ModelProviderConformanceCheck,
    ModelProviderConformanceReport,
    ModelProviderScenario,
    ModelProviderTextScenario
} from './lib/model/conformance';
export { UnknownModelProviderError } from './lib/errors/unknown-model-provider.error';
export { UnknownModelError } from './lib/errors/unknown-model.error';
export { NoModelsConfiguredError } from './lib/errors/no-models-configured.error';

// --- the tool seam ---
//
// `ToolSpec` / `ToolContext` / `COPILOT_TOOL_PROVIDER` are gone: the tool
// contract and its registry are shared with the MCP endpoint and live in
// `@orthacms/tools-server` (ADR-0006 §2, and the amendment to ADR-0005 §3).
// `validateToolInput` followed them there: it interprets a `ToolDefinition`'s
// `inputSchema`, and keeping it here meant only the copilot's run loop applied
// it while the MCP endpoint dispatched unvalidated arguments. What stays is the
// **offer-time policy**, which is genuinely the copilot's own and needs neither
// Nest nor a registry to be correct.
export { resolveCapabilityProfile } from './lib/tools/capability-profile';
export type {
    AuthorizableTool,
    CapabilityProfile,
    CopilotActor,
    ResolveCapabilityProfileInput,
    ToolPermissionKey,
    WithheldReason,
    WithheldTool
} from './lib/tools/capability-profile';

// --- the run (phase 1) ---
export {
    DEFAULT_RUN_LIMITS,
    interruptionNote,
    wasCutShort
} from './lib/run/run-limits';
export type { RunLimits, RunStopReason } from './lib/run/run-limits';
export type {
    CopilotRunEvent,
    RunStartedEvent,
    RunTextDeltaEvent,
    RunToolCallEvent,
    RunToolResultEvent,
    RunPermissionRequestEvent,
    ToolPermissionDecision,
    RunProposalEvent,
    RunDoneEvent,
    RunErrorEvent
} from './lib/run/run-event';
export {
    fenceUntrusted,
    MAX_UNTRUSTED_PAYLOAD_CHARS,
    UNTRUSTED_DATA_RULE
} from './lib/run/untrusted';

// --- proposals (phase 3) ---
export { isProposalDraft } from './lib/proposals/proposal';
export type {
    ProposalChange,
    ProposalDraft,
    ProposalStatus,
    ProposalTarget
} from './lib/proposals/proposal';
export { COPILOT_PROPOSAL_APPLIER } from './lib/proposals/proposal-applier';
export type {
    ProposalActor,
    ProposalApplier,
    ProposalApplyResult
} from './lib/proposals/proposal-applier';

// Attachments — the port the run engine reads a turn's attached files through,
// inverted like the applier so this package still knows no plugin exists.
export { COPILOT_ATTACHMENT_RESOLVER } from './lib/attachments/attachment';
export type {
    AttachmentRef,
    AttachmentResolver
} from './lib/attachments/attachment';

// --- skills ---
//
// Reusable instruction packets a run can be given. Two sources (the host's
// config and the CMS) produce one catalogue; the merge rule and the shape
// checks are pure, so both the server's write routes and its boot-time
// validation read the same definition of "valid".
export {
    MAX_RUN_SKILLS,
    MAX_SKILL_DESCRIPTION_LENGTH,
    MAX_SKILL_INSTRUCTIONS_LENGTH,
    MAX_SKILL_NAME_LENGTH,
    MAX_SKILL_SUMMARIES,
    MAX_SKILL_TITLE_LENGTH,
    SKILL_NAME_PATTERN,
    toSkillRef,
    validateSkillShape
} from './lib/skills/skill';
export type {
    Skill,
    SkillDefinition,
    SkillMode,
    SkillRef,
    SkillSource
} from './lib/skills/skill';
export { buildSkillRegistry, mergeSkills } from './lib/skills/skill-registry';
export type { SkillRegistry } from './lib/skills/skill-registry';
