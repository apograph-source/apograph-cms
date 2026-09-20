import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PERMISSIONS } from '@orthacms/identity-server';
import type { ToolContext } from '@orthacms/tools-server';
import { PublicListEntriesQueryDto } from '../public-api/http/dto/public-list-entries-query.dto';
import {
    assertDraftVisibility,
    requireLocator,
    requireTypeName,
    validateToolInput
} from './tool-input';

const ID = '11111111-1111-4111-8111-111111111111';
const GROUP = '22222222-2222-4222-8222-222222222222';

/** A context holding exactly the named permissions. */
function contextWith(...permissions: string[]): ToolContext {
    const granted = new Set<string>(permissions);
    return {
        actor: {
            kind: 'token',
            id: 'token-1',
            displayName: 'test',
            grantedPermissions: granted,
            userId: null
        },
        workspaceId: 'workspace-1',
        can: (permission) => granted.has(permission)
    };
}

describe('requireTypeName', () => {
    it('returns the type name', () => {
        expect(requireTypeName({ typeName: 'article' })).toBe('article');
    });

    it('rejects a missing type name with a pointer at discovery', () => {
        expect(() => requireTypeName({})).toThrow(/content_types_list/);
    });

    it('rejects a non-string type name', () => {
        expect(() => requireTypeName({ typeName: 42 })).toThrow(
            BadRequestException
        );
    });
});

describe('requireLocator', () => {
    it('accepts an entry id', () => {
        expect(requireLocator({ id: ID })).toEqual({ id: ID });
    });

    it('accepts a translation group id', () => {
        expect(requireLocator({ localeGroupId: GROUP })).toEqual({
            localeGroupId: GROUP
        });
    });

    // Preferring one silently is how a group-addressed call quietly acts on
    // the wrong row.
    it('rejects both at once', () => {
        expect(() => requireLocator({ id: ID, localeGroupId: GROUP })).toThrow(
            /not both/
        );
    });

    it('rejects neither', () => {
        expect(() => requireLocator({})).toThrow(BadRequestException);
    });
});

describe('assertDraftVisibility', () => {
    const readOnly = contextWith(PERMISSIONS.CONTENT_READ);
    const writer = contextWith(
        PERMISSIONS.CONTENT_READ,
        PERMISSIONS.CONTENT_UPDATE
    );

    it('allows the published default', () => {
        expect(() => assertDraftVisibility({}, readOnly)).not.toThrow();
        expect(() =>
            assertDraftVisibility({ status: 'published' }, readOnly)
        ).not.toThrow();
    });

    it('refuses drafts to a read-only actor', () => {
        expect(() =>
            assertDraftVisibility({ status: 'draft' }, readOnly)
        ).toThrow(ForbiddenException);
        expect(() =>
            assertDraftVisibility({ status: 'any' }, readOnly)
        ).toThrow(ForbiddenException);
    });

    it('allows drafts to a writer', () => {
        expect(() =>
            assertDraftVisibility({ status: 'draft' }, writer)
        ).not.toThrow();
        expect(() =>
            assertDraftVisibility({ status: 'any' }, writer)
        ).not.toThrow();
    });

    // The DTO's `@IsIn` turns this into a clear 400; refusing it here first
    // would report the wrong problem.
    it('leaves an unrecognised status to the DTO', () => {
        expect(() =>
            assertDraftVisibility({ status: 'sideways' }, readOnly)
        ).not.toThrow();
    });
});

describe('validateToolInput', () => {
    it('accepts a valid query and returns the DTO instance', async () => {
        const dto = await validateToolInput(PublicListEntriesQueryDto, {
            typeName: 'article',
            page: 2,
            pageSize: 10,
            sort: '-publishedAt'
        });

        expect(dto).toBeInstanceOf(PublicListEntriesQueryDto);
        expect(dto.page).toBe(2);
        expect(dto.pageSize).toBe(10);
    });

    // The same bound the HTTP route enforces, because it is literally the
    // same DTO — this is the drift the shared class exists to prevent.
    it('enforces the DTO’s pageSize cap [content:I-29]', async () => {
        await expect(
            validateToolInput(PublicListEntriesQueryDto, { pageSize: 5000 })
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an unknown argument rather than ignoring it', async () => {
        await expect(
            validateToolInput(PublicListEntriesQueryDto, { pagesize: 10 })
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reports per-field issues a model can act on', async () => {
        expect.assertions(2);
        try {
            await validateToolInput(PublicListEntriesQueryDto, {
                status: 'sideways'
            });
        } catch (error) {
            const body = (error as BadRequestException).getResponse() as {
                issues: { field: string }[];
            };
            expect(body.issues).toHaveLength(1);
            expect(body.issues[0].field).toBe('status');
        }
    });

    // The routing keys are the tool's own parameters; the query DTOs describe
    // an HTTP query string and know nothing about them.
    it('ignores the addressing keys instead of rejecting them', async () => {
        await expect(
            validateToolInput(PublicListEntriesQueryDto, {
                typeName: 'article',
                id: ID,
                localeGroupId: GROUP,
                field: 'tags'
            })
        ).resolves.toBeInstanceOf(PublicListEntriesQueryDto);
    });
});
