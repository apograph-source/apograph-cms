import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import { Workspace } from '../../domain/workspace';
import type { WorkspaceId } from '../../domain/value-objects/workspace-id';
import type { WorkspaceRepository } from '../../domain/workspace.repository';
import type { ContentGrantKind } from '../../domain/content-grant';
import { workspaces } from '../schema/workspaces';
import { memberships } from '../schema/memberships';
import { workspaceContent } from '../schema/workspace-content';
import { WorkspaceMapper } from './workspace.mapper';
import { lockWorkspaceExclusive } from './workspace-lock';
import { isUniqueViolation } from './unique-violation';
import { SlugTakenError } from '../../domain/errors';

/** The unique index that makes `workspaces.slug` the real arbiter of uniqueness. */
const SLUG_UNIQUE_CONSTRAINT = 'workspaces_slug_unique';

/**
 * Drizzle-backed {@link WorkspaceRepository}. Loads and saves the whole
 * {@link Workspace} aggregate (workspace row + membership + content-grant rows),
 * running every statement through {@link UnitOfWork.current} so it transparently
 * joins the use case's transaction.
 *
 * Membership and grant writes use `onConflictDoNothing`, so a concurrent
 * duplicate is a no-op rather than a constraint error — the aggregate has
 * already decided (from its loaded state) whether a change occurred and thus
 * whether an audit event is recorded.
 */
@Injectable()
export class DrizzleWorkspaceRepository implements WorkspaceRepository {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly mapper: WorkspaceMapper
    ) {}

    /** {@inheritDoc WorkspaceRepository.findById} */
    findById(id: WorkspaceId): Promise<Workspace | null> {
        return this.load(id);
    }

    /**
     * Loads the aggregate after taking the workspace's **exclusive** advisory
     * content lock — the loading strategy for delete / content-revoke, which
     * must serialize against concurrent entry writes (those take the *shared*
     * lock). The lock auto-releases at commit/rollback, so it must be called
     * inside the unit of work.
     */
    async findByIdForContentMutation(
        id: WorkspaceId
    ): Promise<Workspace | null> {
        await lockWorkspaceExclusive(this.uow.current(), id.value);
        return this.load(id);
    }

    /** {@inheritDoc WorkspaceRepository.save} */
    async save(workspace: Workspace): Promise<void> {
        const changes = workspace.changes();
        const executor = this.uow.current();
        const workspaceId = workspace.id.value;

        if (changes.isNew) {
            try {
                await executor
                    .insert(workspaces)
                    .values(this.mapper.toInsertRow(workspace));
            } catch (error) {
                // The pre-insert availability check can't be authoritative — two
                // concurrent creates both read "free". The unique index decides,
                // so translate its rejection into the same domain error the
                // pre-check raises; otherwise the loser of an ordinary race gets
                // a 500 instead of the 409 this collision has always meant.
                if (isUniqueViolation(error, SLUG_UNIQUE_CONSTRAINT)) {
                    throw new SlugTakenError(workspace.slug.value);
                }
                throw error;
            }
        } else {
            const patch: Partial<typeof workspaces.$inferInsert> = {};
            if (changes.profileChanged) {
                patch.name = workspace.name;
                patch.description = workspace.description;
                patch.color = workspace.color.value;
            }
            if (changes.statusChanged) {
                patch.status = workspace.status.value;
            }
            if (Object.keys(patch).length > 0) {
                await executor
                    .update(workspaces)
                    .set(patch)
                    .where(eq(workspaces.id, workspaceId));
            }
        }

        if (changes.addedMemberIds.length > 0) {
            await executor
                .insert(memberships)
                .values(
                    changes.addedMemberIds.map((userId) => ({
                        workspaceId,
                        userId
                    }))
                )
                .onConflictDoNothing();
        }
        if (changes.removedMemberIds.length > 0) {
            await executor
                .delete(memberships)
                .where(
                    and(
                        eq(memberships.workspaceId, workspaceId),
                        inArray(memberships.userId, changes.removedMemberIds)
                    )
                );
        }

        if (changes.addedGrants.length > 0) {
            await executor
                .insert(workspaceContent)
                .values(
                    changes.addedGrants.map((grant) => ({
                        workspaceId,
                        kind: grant.kind,
                        slug: grant.slug
                    }))
                )
                .onConflictDoNothing();
        }
        if (changes.removedGrantSlugs.length > 0) {
            await executor
                .delete(workspaceContent)
                .where(
                    and(
                        eq(workspaceContent.workspaceId, workspaceId),
                        inArray(
                            workspaceContent.slug,
                            changes.removedGrantSlugs
                        )
                    )
                );
        }
    }

    /** {@inheritDoc WorkspaceRepository.delete} */
    async delete(workspace: Workspace): Promise<void> {
        await this.uow
            .current()
            .delete(workspaces)
            .where(eq(workspaces.id, workspace.id.value));
    }

    /** {@inheritDoc WorkspaceRepository.existsBySlug} */
    async existsBySlug(slug: string): Promise<boolean> {
        const [existing] = await this.uow
            .current()
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.slug, slug))
            .limit(1);
        return !!existing;
    }

    /** Loads the aggregate for `id`, or `null` when it doesn't exist. */
    private async load(id: WorkspaceId): Promise<Workspace | null> {
        const executor = this.uow.current();
        const [row] = await executor
            .select()
            .from(workspaces)
            .where(eq(workspaces.id, id.value))
            .limit(1);
        if (!row) {
            return null;
        }

        const memberRows = await executor
            .select({
                userId: memberships.userId,
                createdAt: memberships.createdAt
            })
            .from(memberships)
            .where(eq(memberships.workspaceId, id.value))
            .orderBy(asc(memberships.createdAt), asc(memberships.id));

        const grantRows = await executor
            .select({
                kind: workspaceContent.kind,
                slug: workspaceContent.slug
            })
            .from(workspaceContent)
            .where(eq(workspaceContent.workspaceId, id.value));

        return this.mapper.toDomain(
            row,
            memberRows.map((member) => member.userId),
            grantRows.map((grant) => ({
                kind: grant.kind as ContentGrantKind,
                slug: grant.slug
            }))
        );
    }
}
