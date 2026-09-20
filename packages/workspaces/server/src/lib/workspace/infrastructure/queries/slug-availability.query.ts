import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import { workspaces } from '../schema/workspaces';

/**
 * Read model backing the create wizard's live slug-availability check
 * (`GET /api/workspaces/slug-available`). A pure read — it applies no format
 * rule (an as-typed slug may still be invalid), only whether the value is free.
 * The create flow's authoritative uniqueness guard is the domain
 * `SlugUniquenessService` plus the DB unique constraint.
 */
@Injectable()
export class SlugAvailabilityQuery {
    constructor(@InjectDatabase() private readonly db: Database) {}

    /** Whether `slug` is free (not yet used by any workspace). */
    async isAvailable(slug: string): Promise<boolean> {
        const [existing] = await this.db
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.slug, slug))
            .limit(1);
        return !existing;
    }
}
