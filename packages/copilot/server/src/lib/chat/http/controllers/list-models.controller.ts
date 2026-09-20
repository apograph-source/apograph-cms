import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import {
    MODEL_REGISTRY,
    type ModelChoice,
    type ModelRegistry
} from '@orthacms/copilot-domain';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';

/** What the model picker renders. */
export interface ModelCatalogue {
    /**
     * Every provider × model pair on offer, in registration order.
     *
     * The order carries the only default there is: `items[0]` is the first
     * registered provider's first model, which is what a run that names
     * neither gets, and what the picker opens on. There is no separate
     * `defaultProvider` field for a client to reconcile with this list.
     */
    items: ModelChoice[];
}

/**
 * `GET /api/copilot/models` — the backends a run may choose from.
 *
 * This is `ModelRegistry.catalogue()` served verbatim, which is what phase 0
 * built it for: a user switches model mid-conversation by picking another row,
 * and an operator changes what is on offer by changing the provider list in
 * `plugins.ts` — the list is the whole configuration. The registry is
 * fixed at boot from `plugins.ts`, so this leaks nothing an operator did not
 * already choose to offer — **names only**, never a credential or a base URL.
 *
 * No `WorkspaceGuard`: the catalogue is deployment-wide, not workspace-owned,
 * and the picker renders before a workspace is necessarily resolved. Gated on
 * `copilot:use` like the rest of the surface. (Registering models at runtime,
 * with encrypted credentials, is the separate phase-4 surface behind
 * `copilot:configure`.)
 */
@UseGuards(PermissionsGuard)
@RequirePermissions(PERMISSIONS.COPILOT_USE)
@Controller('copilot')
export class ListModelsController {
    constructor(
        @Inject(MODEL_REGISTRY) private readonly registry: ModelRegistry
    ) {}

    @Get('models')
    @ApiOperation({ summary: 'List the model backends a run may choose from' })
    list(): ModelCatalogue {
        return { items: this.registry.catalogue() };
    }
}
