import {
    Logger,
    type OnApplicationBootstrap,
    type Provider,
    type Type
} from '@nestjs/common';
import type { ProposalApplier } from '@orthacms/copilot-domain';
import { ProposalApplierRegistry } from './proposal-applier.registry';

/** Registers a plugin's proposal appliers with the copilot at bootstrap. */
class AppliersBootstrapper implements OnApplicationBootstrap {
    private readonly logger = new Logger(AppliersBootstrapper.name);

    constructor(
        private readonly label: string,
        private readonly registry: ProposalApplierRegistry | null,
        private readonly appliers: readonly ProposalApplier[]
    ) {}

    onApplicationBootstrap(): void {
        // A deployment that doesn't register `CopilotPlugin` is normal, and
        // every binding plugin must boot without it.
        if (!this.registry) {
            return;
        }
        for (const applier of this.appliers) {
            this.registry.register(applier);
        }
        this.logger.log(
            `Registered ${this.label} proposal appliers with the copilot.`
        );
    }
}

/**
 * Builds the DI provider that registers `appliers` with the copilot's proposal
 * registry at bootstrap. The sibling of `copilotToolsRegistrar`, and the same
 * factory shape for the same reason: an explicit `inject` list has no reflected
 * parameter type to get wrong, so an optional dependency cannot silently
 * resolve to `undefined` and leave the plugin's writes unappliable.
 *
 * A plugin that binds propose tools **must** also register the appliers for the
 * kinds those tools produce. Forgetting shows up only when a human clicks
 * Accept — the proposal is refused with "this deployment cannot carry that
 * change out" — so the two belong in the same module block, next to each other.
 */
export function copilotAppliersRegistrar(
    label: string,
    ...appliers: Type<ProposalApplier>[]
): Provider {
    return {
        provide: `COPILOT_APPLIERS_REGISTRAR_${label.toUpperCase()}`,
        useFactory: (
            registry: ProposalApplierRegistry | null,
            ...resolved: ProposalApplier[]
        ) => new AppliersBootstrapper(label, registry, resolved),
        inject: [
            { token: ProposalApplierRegistry, optional: true },
            ...appliers
        ]
    };
}
