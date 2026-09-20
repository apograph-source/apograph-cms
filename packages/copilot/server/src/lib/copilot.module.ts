import { DynamicModule, Module } from '@nestjs/common';
import {
    buildSkillRegistry,
    MODEL_REGISTRY,
    MODEL_RESOLVER,
    type ModelResolver,
    type SkillDefinition
} from '@orthacms/copilot-domain';
import { DatabaseModule } from '@orthacms/database';
import { ToolsModule } from '@orthacms/tools-server';
import { COPILOT_CONFIG, COPILOT_SKILL_REGISTRY } from './copilot.tokens';
import {
    buildModelRegistry,
    type ProviderRegistration
} from './infrastructure/model-registry';
import type { CopilotPluginConfig } from './types/copilot-config';
import { CapabilityProfileService } from './chat/application/capability-profile.service';
import { DecideProposalService } from './chat/application/decide-proposal.service';
import { ToolPermissionBroker } from './chat/application/tool-permission.broker';
import { ProposalApplierRegistry } from './chat/application/proposal-applier.registry';
import { ContentTypeSummaryService } from './chat/application/content-type-summary.service';
import { RunEngine } from './chat/application/run-engine.service';
import { ConversationRepository } from './chat/infrastructure/persistence/conversation.repository';
import { ProposalRepository } from './chat/infrastructure/persistence/proposal.repository';
import { CreateRunController } from './chat/http/controllers/create-run.controller';
import { GetConversationController } from './chat/http/controllers/get-conversation.controller';
import { ListConversationsController } from './chat/http/controllers/list-conversations.controller';
import { ListModelsController } from './chat/http/controllers/list-models.controller';
import { ProposalsController } from './chat/http/controllers/proposals.controller';
import { ToolPermissionController } from './chat/http/controllers/tool-permission.controller';
import { UpdateConversationController } from './chat/http/controllers/update-conversation.controller';
import { SkillCatalogService } from './skills/application/skill-catalog.service';
import { SkillRepository } from './skills/infrastructure/persistence/skill.repository';
import { ListSkillsController } from './skills/http/controllers/list-skills.controller';
import { ManageSkillsController } from './skills/http/controllers/manage-skills.controller';

/** Options `CopilotModule.forRoot` binds into DI. */
export interface CopilotModuleOptions {
    /** The model backends this deployment offers, in preference order. */
    providers: readonly ProviderRegistration[];
    /** Optional custom handler picking a provider per run. */
    resolve?: ModelResolver;
    /** Skills defined in code, available in every workspace. */
    skills?: readonly SkillDefinition[];
    /** Host config (kill switch + output ceiling + run limits). */
    config: CopilotPluginConfig;
}

/**
 * NestJS module for the copilot plugin. Registered globally, like every other
 * plugin module here, so a tool-binding plugin can inject
 * {@link CopilotToolRegistry} without an explicit import.
 *
 * Phase 1 adds the chat vertical slice on top of phase 0's model seam: the SSE
 * run route, the bounded run engine, the capability profile, and conversation
 * persistence. The tools themselves are bound by the plugins that own the logic
 * they wrap, never by this module.
 */
@Module({})
export class CopilotModule {
    /** Creates the global dynamic module around a validated config. */
    static forRoot(options: CopilotModuleOptions): DynamicModule {
        // No `resolve` handler means the **first registered provider** serves
        // every run that names none. There is no separate `defaultProvider`
        // setting to keep in sync with the list — the list *is* the setting,
        // and its order is the preference order (`catalogue()` renders in it,
        // and the admin's picker opens on its first entry).
        const [first] = options.providers;
        if (!first && options.config.enabled) {
            throw new Error(
                'CopilotModule is enabled but has no model provider — the first one registered ' +
                    'is what serves a run that names none.'
            );
        }
        // A disabled copilot registers no controller, so nothing can reach the
        // resolver and there is no default to name. It still has to resolve to
        // *something*: the module binds `MODEL_RESOLVER` either way, because the
        // switch must not change the shape of the DI graph. Asking for a
        // provider through it fails in `ModelRegistry.get`, naming the empty
        // catalogue, which is the same error an unknown name gets.
        const resolver: ModelResolver =
            options.resolve ?? ((): string => first?.name ?? '');

        return {
            module: CopilotModule,
            global: true,
            // `DatabaseModule` is global, but importing it explicitly keeps
            // this module standalone-testable.
            // `ToolsModule` carries the shared tool registry — the same
            // catalogue the MCP endpoint serves. Imported rather than provided
            // so a deployment running the copilot *without* MCP still has one,
            // and one running both has exactly one.
            imports: [DatabaseModule, ToolsModule],
            // **The kill switch, applied where MCP applies its own**
            // (`mcp.module.ts`): a disabled deployment registers no copilot
            // controller at all, so every `/api/copilot/*` route 404s.
            //
            // It used to be read in one place only — `RunEngine.run` — which
            // made "off" mean *the send button returns an error frame*. The
            // panel, the Agents view, the model catalogue, the conversation and
            // skill routes and the tables all stayed live, so a deployment that
            // had opted out still offered the whole feature and refused at the
            // last step. Off is now off.
            //
            // The providers, the registry and the skill catalogue below stay
            // bound either way. They cost nothing unbuilt, and the shared
            // `ToolRegistry` must not change shape with this switch — the MCP
            // endpoint serves the same catalogue, and a tool contributed by
            // `content` is registered against `ToolsModule`, not this one.
            controllers: options.config.enabled
                ? [
                      CreateRunController,
                      // Before `GetConversationController`: `conversations/:id` and
                      // `models` can't collide (different first segments), but keep
                      // the read routes grouped after the run route.
                      ListModelsController,
                      ListConversationsController,
                      // `PATCH conversations/:id`. No ordering hazard with the `GET`
                      // wildcard below — Express matches method and path together —
                      // but it reads with the other conversation routes.
                      UpdateConversationController,
                      // Before `GetConversationController`, whose `conversations/:id`
                      // is the only wildcard here — Express matches in declaration
                      // order, so the literal-prefixed routes go first.
                      ProposalsController,
                      // Before `GetConversationController` for the same reason as
                      // the others: its `conversations/:id` is the only wildcard, and
                      // Express matches in declaration order.
                      ToolPermissionController,
                      // Both skill controllers before the conversation wildcard, for
                      // the same declaration-order reason as the rest. `skills` and
                      // `skills/:id` live in different controllers and cannot
                      // collide (different segment counts); `skills/manage` is
                      // declared above `skills/:id` inside the manage controller.
                      ListSkillsController,
                      ManageSkillsController,
                      GetConversationController
                  ]
                : [],
            providers: [
                { provide: COPILOT_CONFIG, useValue: options.config },
                {
                    provide: MODEL_REGISTRY,
                    useValue: buildModelRegistry(options.providers)
                },
                {
                    // Always bound, empty when the host declared none: "this
                    // deployment ships no skills" must not present as a missing
                    // dependency.
                    provide: COPILOT_SKILL_REGISTRY,
                    useValue: buildSkillRegistry(options.skills ?? [])
                },
                { provide: MODEL_RESOLVER, useValue: resolver },
                CapabilityProfileService,
                ContentTypeSummaryService,
                ConversationRepository,
                ProposalRepository,
                ProposalApplierRegistry,
                DecideProposalService,
                {
                    // Constructed through a factory so the operator's
                    // `permissionDecisionBudgetMs` reaches it — the wait for a
                    // permission decision is an accessibility limit as much as a
                    // resource one, and five minutes is not generous for a
                    // screen-magnifier or switch-access user (`ORT-118`).
                    provide: ToolPermissionBroker,
                    useFactory: () => {
                        const broker = new ToolPermissionBroker();
                        broker.configure(
                            options.config.permissionDecisionBudgetMs
                        );
                        return broker;
                    }
                },
                SkillRepository,
                SkillCatalogService,
                RunEngine
            ],
            exports: [
                COPILOT_CONFIG,
                MODEL_REGISTRY,
                MODEL_RESOLVER,
                COPILOT_SKILL_REGISTRY,
                // Exported so the plugins that own writes can register their
                // proposal appliers. Tools go to the shared `ToolRegistry` in
                // `@orthacms/tools-server`, which the MCP module provides.
                ProposalApplierRegistry
            ]
        };
    }
}
