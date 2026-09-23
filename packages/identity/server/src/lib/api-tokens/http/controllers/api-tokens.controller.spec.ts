import { BadRequestException } from '@nestjs/common';
import type { PublicUser } from '../../../auth/services/auth.service';
import type {
    ApiTokenService,
    MintApiTokenInput,
    MintedApiToken
} from '../../application/api-token.service';
import { UnknownWorkspaceError } from '../../domain/unknown-workspace.error';
import { ApiTokensController } from './api-tokens.controller';
import type { CreateApiTokenDto } from '../dto/create-api-token.dto';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';

const ADMIN: PublicUser = {
    id: '66666666-6666-4666-8666-666666666666',
    email: 'admin@example.com',
    name: 'Ada',
    roleId: '55555555-5555-4555-8555-555555555555',
    status: 'active'
};

/** The body the strict `ValidationPipe` would have handed the controller. */
function body(over: Partial<CreateApiTokenDto> = {}): CreateApiTokenDto {
    return {
        name: 'CI',
        workspaceIds: [WORKSPACE],
        scope: 'read',
        ...over
    } as CreateApiTokenDto;
}

/**
 * A service that records what it was asked to mint. `mintFails` makes the
 * mint throw, standing in for the workspace-directory check refusing a bucket.
 */
function makeService(options: { mintFails?: unknown } = {}) {
    const mints: MintApiTokenInput[] = [];
    const revokes: unknown[][] = [];
    const lists: unknown[] = [];
    const service = {
        mint: async (input: MintApiTokenInput): Promise<MintedApiToken> => {
            mints.push(input);
            if (options.mintFails !== undefined) {
                throw options.mintFails;
            }
            return {
                token: {
                    id: 'token-1',
                    name: input.name,
                    workspaceIds: [...input.workspaceIds],
                    scope: input.scope,
                    lookupPrefix: 'orthacms_abc',
                    expiresAt: input.expiresAt ?? null,
                    lastUsedAt: null,
                    revokedAt: null,
                    createdAt: new Date('2026-01-01T00:00:00Z')
                },
                secret: 'orthacms_secret'
            };
        },
        revoke: async (...args: unknown[]) => {
            revokes.push(args);
            return true;
        },
        list: async (options_: unknown) => {
            lists.push(options_);
            return { items: [], total: 0, page: 1, pageSize: 20 };
        }
    } as unknown as ApiTokenService;
    return {
        controller: new ApiTokensController(service),
        mints,
        revokes,
        lists
    };
}

/**
 * The session-authenticated management routes. The controller itself holds one
 * piece of logic — `parseExpiry` — and one translation: a domain refusal about
 * workspace ids is a client mistake, not an authorization failure.
 */
describe('ApiTokensController', () => {
    describe('expiry parsing', () => {
        it('treats an omitted expiry as "never expires"', async () => {
            const { controller, mints } = makeService();

            await controller.create(body(), ADMIN);

            expect(mints[0].expiresAt).toBeUndefined();
        });

        it('treats an explicit null as absent, not as a value', async () => {
            // BUG (found against a live server): `@IsOptional()` skips the rest
            // of the chain for `null` as well as `undefined`, so an explicit
            // `null` reached `parseExpiry` — where a `=== undefined` guard let
            // it fall through to `new Date(null)`, which is the epoch. The one
            // spelling that most plainly says "no expiry" was therefore refused
            // as being in the past. The admin never sends it, but the field is
            // documented as optional in the published OpenAPI, so an integrator
            // writing `{"expiresAt": null}` got a 400 telling them to pick a
            // future date.
            const { controller, mints } = makeService();

            await expect(
                controller.create(
                    body({ expiresAt: null as unknown as undefined }),
                    ADMIN
                )
            ).resolves.toBeDefined();
            expect(mints[0].expiresAt).toBeUndefined();
        });

        it('refuses a timestamp in the past', async () => {
            // A token born expired is always a client mistake, and minting one
            // silently would leave an integration failing with a flat 401 and
            // nothing to explain it.
            const { controller, mints } = makeService();

            await expect(
                controller.create(
                    body({ expiresAt: '2020-01-01T00:00:00.000Z' }),
                    ADMIN
                )
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(mints).toEqual([]);
        });

        it('passes a future timestamp through as a Date', async () => {
            const { controller, mints } = makeService();
            const iso = '2099-01-01T00:00:00.000Z';

            await controller.create(body({ expiresAt: iso }), ADMIN);

            expect(mints[0].expiresAt).toBeInstanceOf(Date);
            expect((mints[0].expiresAt as Date).toISOString()).toBe(iso);
        });

        it('refuses an unparseable string rather than handing on an Invalid Date', async () => {
            // `new Date('nonsense').getTime()` is `NaN`, and `NaN <= Date.now()`
            // is false — so before this guard the past-check did not fire and an
            // Invalid Date reached `mint`. Unreachable over HTTP because
            // `@IsISO8601()` rejects the body first, but that decorator was the
            // whole defence, and this function is the last thing between a bad
            // expiry and the database.
            const { controller, mints } = makeService();

            await expect(
                controller.create(body({ expiresAt: 'not-a-date' }), ADMIN)
            ).rejects.toThrow(/ISO 8601/);
            expect(mints).toHaveLength(0);
        });
    });

    describe('minting', () => {
        it('names the acting admin by id and by a frozen email snapshot', async () => {
            // The audit row must not be a foreign key into a user who may later
            // be renamed or deleted.
            const { controller, mints } = makeService();

            await controller.create(body(), ADMIN);

            expect(mints[0].createdBy).toBe(ADMIN.id);
            expect(mints[0].actor).toEqual({
                id: ADMIN.id,
                email: ADMIN.email
            });
        });

        it('returns the one-time secret alongside the metadata', async () => {
            const { controller } = makeService();

            const response = await controller.create(body(), ADMIN);

            expect(response.secret).toBe('orthacms_secret');
            expect(response.id).toBe('token-1');
        });

        it('turns an unknown workspace into a 400, not a 500', async () => {
            // A bucket naming a workspace that does not exist is a client
            // mistake alongside the DTO's own shape errors — and nothing leaks,
            // since only an admin reaches this route and they are being told
            // about ids they just supplied.
            const missing = new UnknownWorkspaceError(['ws-nope']);
            const { controller } = makeService({ mintFails: missing });

            await expect(
                controller.create(body(), ADMIN)
            ).rejects.toBeInstanceOf(BadRequestException);
            await expect(controller.create(body(), ADMIN)).rejects.toThrow(
                missing.message
            );
        });

        it('rethrows anything else untouched', async () => {
            // Only the one domain error is a client mistake; swallowing a
            // database failure into a 400 would blame the caller for an outage.
            const boom = new Error('connection reset');
            const { controller } = makeService({ mintFails: boom });

            await expect(controller.create(body(), ADMIN)).rejects.toBe(boom);
        });
    });

    describe('the other routes', () => {
        it('defaults the page and page size on list', async () => {
            const { controller, lists } = makeService();

            await controller.list({});

            expect(lists[0]).toMatchObject({ page: 1 });
            expect((lists[0] as { pageSize: number }).pageSize).toBeGreaterThan(
                0
            );
        });

        it('names the acting admin on revoke too', async () => {
            const { controller, revokes } = makeService();

            await controller.revoke('token-1', ADMIN);

            expect(revokes[0]).toEqual([
                'token-1',
                { id: ADMIN.id, email: ADMIN.email }
            ]);
        });
    });
});
