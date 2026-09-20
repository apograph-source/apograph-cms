import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import { roles } from '../../schema';
import { RoleNotFoundError, SystemRoleProtectedError } from '../errors';

/** Role operations for the identity plugin. Enforces system-role protection. */
@Injectable()
export class RolesService {
    constructor(@InjectDatabase() private readonly db: Database) {}

    /**
     * Deletes a non-system role by id. The guard lives in the SQL predicate
     * (`is_system = false`), so protection holds atomically even under
     * concurrent writes; a zero-row result is then disambiguated into a
     * precise error.
     *
     * @throws {SystemRoleProtectedError} the role is a protected system role.
     * @throws {RoleNotFoundError} no role has that id.
     */
    async delete(id: string): Promise<void> {
        const result = await this.db
            .delete(roles)
            .where(and(eq(roles.id, id), eq(roles.isSystem, false)));

        if ((result.rowCount ?? 0) > 0) {
            return;
        }

        // Nothing deleted: distinguish "protected" from "missing".
        const [existing] = await this.db
            .select({ isSystem: roles.isSystem })
            .from(roles)
            .where(eq(roles.id, id));

        if (existing?.isSystem) {
            throw new SystemRoleProtectedError(id);
        }
        throw new RoleNotFoundError(id);
    }
}
