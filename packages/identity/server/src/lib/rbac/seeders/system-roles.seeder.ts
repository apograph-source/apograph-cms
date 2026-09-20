import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDatabase, type Database } from '@orthacms/database';
import { seedSystemRoles } from './seed-system-roles';

/**
 * Seeds the system roles during application bootstrap. Implemented as a Nest
 * lifecycle hook (not the pre-app `onPluginInit`) so the Drizzle client is
 * injected through DI rather than reached for as a singleton.
 *
 * `onApplicationBootstrap` runs inside `app.init()` — after every module is
 * wired but before the server listens — so seeding completes before any
 * request is served, and a failure aborts boot (fail-fast).
 */
@Injectable()
export class SystemRolesSeeder implements OnApplicationBootstrap {
    private readonly logger = new Logger(SystemRolesSeeder.name);

    constructor(@InjectDatabase() private readonly db: Database) {}

    async onApplicationBootstrap(): Promise<void> {
        await seedSystemRoles(this.db);
        this.logger.log('System roles seeded');
    }
}
