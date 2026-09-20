import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
    EntryWriteExtensionRegistry,
    type EntryWriteExtensionInput,
    type EntryWriteExtensionTarget
} from '@orthacms/content-server';
import { sameAccess, type EntryAccess } from '@orthacms/segments-domain';
import {
    ACCESS_EXTENSION_KEY,
    EntryAccessWriteExtension
} from './entry-access-write-extension';

/** The type only ever supplies its `name` here. */
const TYPE = { name: 'article' } as EntryWriteExtensionTarget['type'];

/**
 * A stand-in access service over one in-memory row.
 *
 * `groupHas` / `setForGroup` rather than `get` / `set`, because the extension
 * asks about the entry's whole **locale group** — a save that matches the
 * English article but not the German one still has work to do. The group's
 * membership is the service's business and is exercised end-to-end; what this
 * spec is about is the permission gate around the write.
 */
function accessService(stored: EntryAccess = { allow: [], deny: [] }) {
    return {
        current: stored,
        writes: 0,
        async get() {
            return this.current;
        },
        async groupHas(
            _workspaceId: string,
            _type: unknown,
            _entryId: string,
            wanted: EntryAccess
        ) {
            return sameAccess(this.current, wanted);
        },
        inherits: 0,
        async inheritFromGroup() {
            this.inherits += 1;
        },
        async setForGroup(input: {
            entryId: string;
            allow: string[];
            deny: string[];
        }) {
            this.writes += 1;
            this.current = { allow: input.allow, deny: input.deny };
            return { access: this.current, entryIds: [input.entryId] };
        }
    };
}

/** A stand-in principal + permissions pair for one role's grants. */
function actor(granted: string[] | null) {
    return {
        principal: { current: () => (granted ? { roleId: 'r' } : undefined) },
        permissions: { forRole: async () => granted ?? [] }
    };
}

/** Builds the extension over the two stand-ins. */
function build(
    access: ReturnType<typeof accessService>,
    granted: string[] | null
) {
    const { principal, permissions } = actor(granted);
    return new EntryAccessWriteExtension(
        access as never,
        principal as never,
        permissions as never
    );
}

/** One `apply` call over a payload. */
function input(value: unknown): EntryWriteExtensionInput {
    return {
        executor: {} as EntryWriteExtensionInput['executor'],
        type: TYPE,
        entryId: 'e1',
        workspaceId: 'w1',
        value
    };
}

const MANAGE = ['segments:manage'];

describe('EntryAccessWriteExtension', () => {
    describe('apply', () => {
        it('writes the audiences the save carried', async () => {
            const access = accessService();
            await build(access, MANAGE).apply(
                input({ allow: ['s1'], deny: [] })
            );

            expect(access.current).toEqual({ allow: ['s1'], deny: [] });
        });

        it('refuses a caller who may edit the record but not decide who reads it [segments:I-17]', async () => {
            // The escalation this gate exists for: the save it rides asked only
            // for `content:update`, so without this a contributor could restrict
            // any entry they can edit by naming the key in the body.
            const access = accessService();
            const extension = build(access, ['content:update']);

            await expect(
                extension.apply(input({ allow: ['s1'], deny: [] }))
            ).rejects.toBeInstanceOf(ForbiddenException);
            expect(access.writes).toBe(0);
        });

        it('refuses a caller it cannot identify [segments:I-18]', async () => {
            // A path the principal middleware did not cover cannot be shown to
            // hold the permission, so it does not.
            const extension = build(accessService(), null);

            await expect(
                extension.apply(input({ allow: ['s1'], deny: [] }))
            ).rejects.toBeInstanceOf(ForbiddenException);
        });

        it('needs no permission to re-assert what is already stored', async () => {
            // What keeps **restore** working for anyone who may restore: putting
            // back a version whose audiences match today's is not a decision
            // about access. Order is ignored, so a reordered list is still a
            // no-op.
            const access = accessService({ allow: ['s2', 's1'], deny: [] });
            const extension = build(access, ['content:update']);

            await extension.apply(input({ allow: ['s1', 's2'], deny: [] }));

            expect(access.writes).toBe(0);
        });

        it('refuses a restore that would change who can read the entry [segments:I-21]', async () => {
            const access = accessService({ allow: ['s1'], deny: [] });
            const extension = build(access, ['content:update']);

            await expect(
                extension.apply(input({ allow: [], deny: [] }))
            ).rejects.toBeInstanceOf(ForbiddenException);
        });

        it('rejects a malformed payload before anything is written', async () => {
            const access = accessService();
            const extension = build(access, MANAGE);

            await expect(extension.apply(input('nope'))).rejects.toBeInstanceOf(
                BadRequestException
            );
            await expect(
                extension.apply(input({ allow: [1], deny: [] }))
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(access.writes).toBe(0);
        });

        it('reads a missing list as empty rather than refusing it [segments:I-14]', async () => {
            const access = accessService({ allow: ['s1'], deny: [] });
            await build(access, MANAGE).apply(input({ deny: ['s2'] }));

            expect(access.current).toEqual({ allow: [], deny: ['s2'] });
        });
    });

    describe('inherit', () => {
        const target: EntryWriteExtensionTarget = {
            executor: {} as EntryWriteExtensionTarget['executor'],
            type: TYPE,
            entryId: 'e1',
            workspaceId: 'w1'
        };

        /**
         * **No permission check, deliberately** — and the reason is the whole
         * point of the hook. Nothing is being decided: the audiences were chosen
         * when they were chosen, and this row is joining a record that already
         * carries them. Requiring `segments:manage` would mean a contributor
         * could not translate a restricted article at all, and the alternative
         * to inheriting is publishing the new German row to everyone, which is
         * the outcome the permission exists to prevent.
         */
        it('gives a new translation the group’s audiences without segments:manage [segments:I-23]', async () => {
            const access = accessService({ allow: ['s1'], deny: [] });

            await build(access, ['content:update']).inherit(target);

            expect(access.inherits).toBe(1);
        });

        it('runs for a caller the principal store cannot identify at all [segments:I-23]', async () => {
            // `apply` refuses that caller; `inherit` must not, or a create on a
            // path the middleware did not cover would produce a public copy of a
            // restricted record.
            const access = accessService({ allow: ['s1'], deny: [] });

            await build(access, null).inherit(target);

            expect(access.inherits).toBe(1);
        });
    });

    describe('the extension key', () => {
        const target: EntryWriteExtensionTarget = {
            executor: {} as EntryWriteExtensionTarget['executor'],
            type: TYPE,
            entryId: 'e1',
            workspaceId: 'w1'
        };

        /**
         * The key is the slot in a save body's `extensions` bag **and** in a
         * revision snapshot's `extra`, and the second one is what makes it
         * permanent: every version already captured names it by this string, so
         * renaming it orphans the access recorded in the whole existing history.
         */
        it('is the literal "access", stable forever [segments:I-20]', () => {
            const extension = build(accessService(), MANAGE);

            expect(ACCESS_EXTENSION_KEY).toBe('access');
            expect(extension.key).toBe(ACCESS_EXTENSION_KEY);
        });

        /**
         * The other half, driven through content's **real** dispatch rather than
         * a description of it: `applyAll` is what decides an extension runs, and
         * the claim is about a bag that does not name this key.
         *
         * That bag is what a restore of a pre-segments version carries — and
         * "leaves the access untouched" is the silence you would not notice.
         * The alternative is worse than it sounds: an absent key read as two
         * empty lists would *open the entry up* on restore, publishing
         * restricted content to everyone because somebody reverted a typo.
         */
        it('leaves the access alone when a restored version does not name it [segments:I-20]', async () => {
            const access = accessService({ allow: ['s1'], deny: [] });
            const registry = new EntryWriteExtensionRegistry();
            registry.register(build(access, MANAGE));

            // A snapshot's `extra` from before this plugin existed: present,
            // but with nothing under our key.
            await registry.applyAll(target, { somethingElse: { a: 1 } });

            expect(access.writes).toBe(0);
            expect(access.current).toEqual({ allow: ['s1'], deny: [] });

            // …and the same registry does write when the key *is* there, so the
            // no-op above is the dispatch skipping it rather than the harness
            // never reaching anything.
            await registry.applyAll(target, {
                [ACCESS_EXTENSION_KEY]: { allow: ['s2'], deny: [] }
            });

            expect(access.current).toEqual({ allow: ['s2'], deny: [] });
        });
    });

    describe('capture', () => {
        const target: EntryWriteExtensionTarget = {
            executor: {} as EntryWriteExtensionTarget['executor'],
            type: TYPE,
            entryId: 'e1',
            workspaceId: 'w1'
        };

        it('records the entry’s audiences', async () => {
            const access = accessService({ allow: ['s1'], deny: ['s2'] });

            await expect(
                build(access, MANAGE).capture(target)
            ).resolves.toEqual({
                allow: ['s1'],
                deny: ['s2']
            });
        });

        it('records nothing for an unrestricted entry', async () => {
            // So a snapshot of ordinary open content stays byte-for-byte what it
            // was before this extension existed.
            await expect(
                build(accessService(), MANAGE).capture(target)
            ).resolves.toBeUndefined();
        });
    });
});
