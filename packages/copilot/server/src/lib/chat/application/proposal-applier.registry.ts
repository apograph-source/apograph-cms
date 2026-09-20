import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
    COPILOT_PROPOSAL_APPLIER,
    type ProposalApplier
} from '@orthacms/copilot-domain';

/**
 * The `kind` → applier lookup, filled by the plugins that own the writes.
 *
 * Same shape and same reasoning as {@link CopilotToolRegistry}: registration is
 * a **runtime `register(...)` call**, because Nest cannot merge a
 * multi-provider token across independent dynamic modules and every plugin here
 * is one. A statically bound {@link COPILOT_PROPOSAL_APPLIER} is honoured too,
 * for a host that binds exactly one.
 *
 * A duplicate `kind` is **refused, not overwritten**. Silently letting the last
 * registration win would let a plugin registered later take over another's
 * writes — the same shadowing the capability profile refuses for tool names,
 * and rather more consequential here, since these are the things that mutate.
 */
@Injectable()
export class ProposalApplierRegistry {
    private readonly logger = new Logger(ProposalApplierRegistry.name);

    private readonly byKind = new Map<string, ProposalApplier>();

    constructor(
        @Optional()
        @Inject(COPILOT_PROPOSAL_APPLIER)
        injected: ProposalApplier[] | ProposalApplier | null = null
    ) {
        const initial = injected
            ? Array.isArray(injected)
                ? injected
                : [injected]
            : [];
        for (const applier of initial) {
            this.register(applier);
        }
    }

    /** Registers an applier. Called by binding plugins at bootstrap. */
    register(applier: ProposalApplier): void {
        const existing = this.byKind.get(applier.kind);
        if (existing) {
            this.logger.error(
                `Two appliers registered for proposal kind "${applier.kind}"; ` +
                    'keeping the first. This is a wiring bug — a proposal of ' +
                    'this kind would otherwise be applied by whichever plugin ' +
                    'happened to load last.'
            );
            return;
        }
        this.byKind.set(applier.kind, applier);
    }

    /** The applier for `kind`, or undefined when no plugin claimed it. */
    get(kind: string): ProposalApplier | undefined {
        return this.byKind.get(kind);
    }

    /** Every registered kind — for diagnostics and the settings UI. */
    kinds(): string[] {
        return [...this.byKind.keys()];
    }
}
