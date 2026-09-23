import type { DomainEvent, OutboxWriter, UnitOfWork } from '@orthacms/database';
import { HashingService } from '../../auth/services/hashing.service';
import { ApiTokenService } from './api-token.service';
import { UnknownWorkspaceError } from '../domain/unknown-workspace.error';
import type {
    ApiTokenRecord,
    DrizzleApiTokenRepository,
    NewApiToken
} from '../infrastructure/persistence/drizzle-api-token.repository';

/** Builds a stored record from an insert plus overridable envelope fields. */
function recordFrom(
    insert: NewApiToken,
    over: Partial<ApiTokenRecord> = {}
): ApiTokenRecord {
    return {
        id: 'token-1',
        workspaceIds: [...insert.workspaceIds],
        name: insert.name,
        tokenHash: insert.tokenHash,
        lookupPrefix: insert.lookupPrefix,
        scope: insert.scope,
        expiresAt: insert.expiresAt,
        createdBy: insert.createdBy,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        ...over
    };
}

describe('ApiTokenService', () => {
    const hashing = new HashingService();

    /**
     * How deep we currently are inside `uow.run`.
     *
     * A `run: (fn) => fn()` fake is invisible: deleting the wrapper in
     * `ApiTokenService` would leave every test in this file green while the
     * token row and its audit event quietly stopped committing together — which
     * is the one thing the transaction exists to guarantee. The depth is the
     * witness that makes the wrapper's absence fail something.
     */
    let uowDepth = 0;

    /** Every collaborator call that must commit transactionally, in order. */
    const committed: { call: string; insideUow: boolean }[] = [];

    beforeEach(() => {
        uowDepth = 0;
        committed.length = 0;
    });

    /** Records a collaborator call together with the transaction witness. */
    function witness(call: string): void {
        committed.push({ call, insideUow: uowDepth > 0 });
    }

    /** A `UnitOfWork` that runs the callback and tracks the nesting. */
    const uow = {
        run: async (fn: () => Promise<unknown>) => {
            uowDepth += 1;
            try {
                return await fn();
            } finally {
                uowDepth -= 1;
            }
        }
    } as UnitOfWork;

    /** An outbox that collects appended events for assertion. */
    function makeOutbox() {
        const events: DomainEvent[] = [];
        return {
            events,
            outbox: {
                append: async (batch: DomainEvent[]) => {
                    witness('outbox.append');
                    events.push(...batch);
                }
            } as OutboxWriter
        };
    }

    /**
     * Builds the service over stubbed collaborators, exposing the outbox.
     * `known` seeds the workspace directory; omit it to leave the optional port
     * unbound, which is how the service behaves with no workspaces plugin.
     */
    function makeService(
        repo: DrizzleApiTokenRepository,
        known?: readonly string[]
    ) {
        const { events, outbox } = makeOutbox();
        const directory = known
            ? {
                  existing: async (ids: readonly string[]) =>
                      ids.filter((id) => known.includes(id))
              }
            : undefined;
        return {
            service: new ApiTokenService(repo, hashing, uow, outbox, directory),
            events
        };
    }

    /**
     * A repo stub that records the last insert and serves a fixed record.
     * `touch` replaces `touchLastUsed`'s body — the fire-and-forget refresh is
     * the one call whose *failure* the service is supposed to swallow.
     */
    function makeRepo(
        row: ApiTokenRecord | null,
        touch: (id: string, at: Date) => Promise<void> = async () => undefined
    ) {
        const touchLastUsed = jest.fn(async (id: string, at: Date) => {
            witness('repo.touchLastUsed');
            return touch(id, at);
        });
        return {
            repo: {
                insert: jest.fn(async (v: NewApiToken) => {
                    witness('repo.insert');
                    return recordFrom(v);
                }),
                findByHash: jest.fn(async () => row),
                findById: jest.fn(),
                list: jest.fn(),
                revoke: jest.fn(),
                touchLastUsed
            } as unknown as DrizzleApiTokenRepository,
            touchLastUsed
        };
    }

    describe('mint', () => {
        it('returns a prefixed secret and stores only its hash', async () => {
            const { repo } = makeRepo(null);
            const { service } = makeService(repo);

            const { token, secret } = await service.mint({
                name: 'CI',
                workspaceIds: ['ws-1'],
                scope: 'read',
                createdBy: 'user-1'
            });

            expect(secret.startsWith('orthacms_')).toBe(true);
            const insert = (repo.insert as jest.Mock).mock.calls[0][0];
            // The raw secret is never persisted — only its SHA-256 hash.
            expect(insert.tokenHash).toBe(hashing.hashToken(secret));
            expect(insert.tokenHash).not.toContain(secret);
            expect(secret.startsWith(insert.lookupPrefix)).toBe(true);
            // The returned view carries no secret field of its own.
            expect(token).not.toHaveProperty('secret');
            expect(token.scope).toBe('read');
        });

        it('persists the whole workspace bucket', async () => {
            const { repo } = makeRepo(null);
            const { service } = makeService(repo);

            const { token } = await service.mint({
                name: 'multi',
                workspaceIds: ['ws-1', 'ws-2', 'ws-3'],
                scope: 'read',
                createdBy: 'user-1'
            });

            const insert = (repo.insert as jest.Mock).mock.calls[0][0];
            expect(insert.workspaceIds).toEqual(['ws-1', 'ws-2', 'ws-3']);
            expect(token.workspaceIds).toEqual(['ws-1', 'ws-2', 'ws-3']);
        });

        it('collapses duplicate workspace ids [api-tokens:I-06]', async () => {
            const { repo } = makeRepo(null);
            const { service } = makeService(repo);

            await service.mint({
                name: 'dupes',
                workspaceIds: ['ws-1', 'ws-2', 'ws-1'],
                scope: 'read',
                createdBy: 'user-1'
            });

            const insert = (repo.insert as jest.Mock).mock.calls[0][0];
            expect(insert.workspaceIds).toEqual(['ws-1', 'ws-2']);
        });

        it('defaults a missing expiry to null (never expires)', async () => {
            const { repo } = makeRepo(null);
            const { service } = makeService(repo);
            await service.mint({
                name: 'forever',
                workspaceIds: ['ws-1'],
                scope: 'full',
                createdBy: 'user-1'
            });
            const insert = (repo.insert as jest.Mock).mock.calls[0][0];
            expect(insert.expiresAt).toBeNull();
        });

        it('emits api_token.created naming the actor and the bucket', async () => {
            // BUG-identity-server-01: minting wrote no audit event at all, so
            // the log could not account for a long-lived credential.
            const { repo } = makeRepo(null);
            const { service, events } = makeService(repo);

            const { secret } = await service.mint({
                name: 'CI',
                workspaceIds: ['ws-1', 'ws-2'],
                scope: 'read',
                createdBy: 'user-1',
                actor: { id: 'user-1', email: 'admin@example.com' }
            });

            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({
                kind: 'api_token.created',
                aggregateType: 'api_token',
                aggregateId: 'token-1',
                payload: {
                    name: 'CI',
                    scope: 'read',
                    workspaceIds: ['ws-1', 'ws-2'],
                    actor: { id: 'user-1', email: 'admin@example.com' }
                }
            });
            // The event must not become a second place the secret lives.
            const serialised = JSON.stringify(events[0]);
            expect(serialised).not.toContain(secret);
            expect(serialised).not.toContain(hashing.hashToken(secret));
        });

        it('falls back to createdBy when no actor is supplied', async () => {
            const { repo } = makeRepo(null);
            const { service, events } = makeService(repo);

            await service.mint({
                name: 'CI',
                workspaceIds: ['ws-1'],
                scope: 'read',
                createdBy: 'user-1'
            });

            expect(events[0].payload).toMatchObject({
                actor: { id: 'user-1', email: null }
            });
        });

        it('writes the row and its audit event inside one transaction', async () => {
            // The pair is the invariant, not either half: a token that existed
            // while its audit row did not would be exactly the credential
            // nobody can account for, and an audit row for a token that failed
            // to insert is a phantom in the log. Only the nesting proves it —
            // both calls succeed just as happily outside a transaction.
            const { repo } = makeRepo(null);
            const { service } = makeService(repo);

            await service.mint({
                name: 'CI',
                workspaceIds: ['ws-1'],
                scope: 'read',
                createdBy: 'user-1'
            });

            expect(committed).toEqual([
                { call: 'repo.insert', insideUow: true },
                { call: 'outbox.append', insideUow: true }
            ]);
        });

        describe('workspace bucket validation', () => {
            const mintInput = (workspaceIds: string[]) => ({
                name: 'CI',
                workspaceIds,
                scope: 'read' as const,
                createdBy: 'user-1'
            });

            it('rejects a bucket naming a workspace that does not exist', async () => {
                // BUG-identity-server-06: `api_token_workspaces` has no
                // cross-plugin FK, so nothing stopped a typo from minting a
                // token scoped to nothing that reads as configured.
                const { repo } = makeRepo(null);
                const { service, events } = makeService(repo, ['ws-1']);

                await expect(
                    service.mint(mintInput(['ws-nope']))
                ).rejects.toBeInstanceOf(UnknownWorkspaceError);
                expect(repo.insert).not.toHaveBeenCalled();
                expect(events).toEqual([]);
            });

            it('rejects a bucket mixing real and phantom ids, naming only the phantoms', async () => {
                const { repo } = makeRepo(null);
                const { service } = makeService(repo, ['ws-1']);

                await expect(
                    service.mint(mintInput(['ws-1', 'ws-nope', 'ws-also-nope']))
                ).rejects.toMatchObject({
                    workspaceIds: ['ws-nope', 'ws-also-nope']
                });
                expect(repo.insert).not.toHaveBeenCalled();
            });

            it('accepts a bucket whose ids all exist', async () => {
                const { repo } = makeRepo(null);
                const { service } = makeService(repo, ['ws-1', 'ws-2']);

                await expect(
                    service.mint(mintInput(['ws-1', 'ws-2']))
                ).resolves.toBeDefined();
            });

            it('checks the deduped bucket, so a repeated bad id reports once', async () => {
                const { repo } = makeRepo(null);
                const { service } = makeService(repo, ['ws-1']);

                await expect(
                    service.mint(mintInput(['ws-nope', 'ws-nope']))
                ).rejects.toMatchObject({ workspaceIds: ['ws-nope'] });
            });

            it('skips the check entirely when no directory is bound [api-tokens:I-07]', async () => {
                // With no workspaces plugin there is nothing to validate
                // against; failing every mint would be worse than the gap.
                const { repo } = makeRepo(null);
                const { service } = makeService(repo);

                await expect(
                    service.mint(mintInput(['ws-anything']))
                ).resolves.toBeDefined();
            });
        });
    });

    describe('revoke', () => {
        const stored = recordFrom({
            workspaceIds: ['ws-1'],
            name: 'temp',
            tokenHash: 'x'.repeat(64),
            lookupPrefix: 'orthacms_tmp',
            scope: 'full',
            expiresAt: null,
            createdBy: 'user-1'
        });

        /** A repo whose `revoke` reports `revoked` and whose read serves `row`. */
        function revokeRepo(revoked: boolean, row: ApiTokenRecord | null) {
            return {
                insert: jest.fn(),
                findByHash: jest.fn(),
                findById: jest.fn(async () => row),
                list: jest.fn(),
                revoke: jest.fn(async () => {
                    witness('repo.revoke');
                    return revoked;
                }),
                touchLastUsed: jest.fn()
            } as unknown as DrizzleApiTokenRepository;
        }

        it('emits api_token.revoked when a live token was killed', async () => {
            const { service, events } = makeService(revokeRepo(true, stored));

            await expect(
                service.revoke('token-1', {
                    id: 'user-9',
                    email: 'admin@example.com'
                })
            ).resolves.toBe(true);

            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({
                kind: 'api_token.revoked',
                aggregateType: 'api_token',
                aggregateId: 'token-1',
                payload: {
                    name: 'temp',
                    scope: 'full',
                    lookupPrefix: 'orthacms_tmp',
                    actor: { id: 'user-9', email: 'admin@example.com' }
                }
            });
        });

        it('reads, revokes and audits inside one transaction', async () => {
            // The read is inside on purpose as well as the write: the event
            // names the token, so reading it outside would let the row change
            // underneath and produce an audit line describing a token that no
            // longer looked like that.
            const { service } = makeService(revokeRepo(true, stored));

            await service.revoke('token-1');

            expect(committed).toEqual([
                { call: 'repo.revoke', insideUow: true },
                { call: 'outbox.append', insideUow: true }
            ]);
        });

        it('emits nothing when the token was already revoked', async () => {
            // The route is idempotent, so a replayed DELETE must not append a
            // second event — the log records the act, not the attempt.
            const { service, events } = makeService(revokeRepo(false, stored));

            await expect(service.revoke('token-1')).resolves.toBe(false);
            expect(events).toEqual([]);
        });

        it('emits nothing for an unknown id', async () => {
            const { service, events } = makeService(revokeRepo(false, null));

            await expect(service.revoke('nope')).resolves.toBe(false);
            expect(events).toEqual([]);
        });
    });

    describe('verify', () => {
        const secret = 'orthacms_secret';
        const baseInsert: NewApiToken = {
            workspaceIds: ['ws-1', 'ws-2'],
            name: 't',
            tokenHash: hashing.hashToken(secret),
            lookupPrefix: 'orthacms_sec',
            scope: 'read',
            expiresAt: null,
            createdBy: 'user-1'
        };

        it('resolves a live token with its whole bucket, and touches last-used when stale', async () => {
            const { repo, touchLastUsed } = makeRepo(recordFrom(baseInsert));
            const { service } = makeService(repo);

            const result = await service.verify(secret);

            expect(result?.workspaceIds).toEqual(['ws-1', 'ws-2']);
            expect(touchLastUsed).toHaveBeenCalledWith(
                'token-1',
                expect.any(Date)
            );
        });

        it('rejects a revoked token', async () => {
            const { repo } = makeRepo(
                recordFrom(baseInsert, { revokedAt: new Date('2026-02-01Z') })
            );
            const { service } = makeService(repo);
            expect(await service.verify(secret)).toBeNull();
        });

        it('rejects an expired token', async () => {
            const { repo } = makeRepo(
                recordFrom(baseInsert, { expiresAt: new Date('2020-01-01Z') })
            );
            const { service } = makeService(repo);
            expect(await service.verify(secret)).toBeNull();
        });

        it('rejects an unknown token', async () => {
            const { repo } = makeRepo(null);
            const { service } = makeService(repo);
            expect(await service.verify(secret)).toBeNull();
        });

        it('does not touch last-used when it is recent', async () => {
            const { repo, touchLastUsed } = makeRepo(
                recordFrom(baseInsert, { lastUsedAt: new Date() })
            );
            const { service } = makeService(repo);
            await service.verify(secret);
            expect(touchLastUsed).not.toHaveBeenCalled();
        });
    });

    /**
     * The `last_used_at` refresh: a throttled, fire-and-forget write plus the
     * `api_token.used` audit row that shares its schedule. Three things here
     * are load-bearing and none of them were exercised — the 60s boundary that
     * bounds the audit volume, the fact that the write never blocks the request
     * it is authenticating, and the `.catch(() => undefined)` that keeps a
     * failed bookkeeping write from failing a valid API call.
     */
    describe('last-used refresh', () => {
        const secret = 'orthacms_secret';
        const baseInsert: NewApiToken = {
            workspaceIds: ['ws-1', 'ws-2'],
            name: 't',
            tokenHash: hashing.hashToken(secret),
            lookupPrefix: 'orthacms_sec',
            scope: 'read',
            expiresAt: null,
            createdBy: 'user-1'
        };

        /** Lets the un-awaited touch run to completion before asserting. */
        async function settle(): Promise<void> {
            for (let i = 0; i < 8; i += 1) {
                await Promise.resolve();
            }
        }

        describe('the 60s throttle, from both sides', () => {
            const NOW = new Date('2026-06-01T12:00:00.000Z');

            beforeEach(() => {
                // Real clocks make a boundary test a race: the millisecond that
                // elapses between building the fixture and the service reading
                // `new Date()` is exactly the margin under test.
                jest.useFakeTimers({ now: NOW });
            });

            afterEach(() => {
                jest.useRealTimers();
            });

            it('touches once the recorded use is a full interval old', async () => {
                const { repo, touchLastUsed } = makeRepo(
                    recordFrom(baseInsert, {
                        lastUsedAt: new Date(NOW.getTime() - 60_000)
                    })
                );
                const { service } = makeService(repo);

                await service.verify(secret);
                await settle();

                expect(touchLastUsed).toHaveBeenCalledWith('token-1', NOW);
            });

            it('leaves it alone one millisecond short of the interval [api-tokens:I-21]', async () => {
                // The staleness check is what bounds the audit volume: a busy
                // integration authenticates thousands of times an hour and the
                // log wants one row a minute, not one per request.
                const { repo, touchLastUsed } = makeRepo(
                    recordFrom(baseInsert, {
                        lastUsedAt: new Date(NOW.getTime() - 59_999)
                    })
                );
                const { service } = makeService(repo);

                await service.verify(secret);
                await settle();

                expect(touchLastUsed).not.toHaveBeenCalled();
            });

            it('touches a token that has never been used', async () => {
                const { repo, touchLastUsed } = makeRepo(
                    recordFrom(baseInsert, { lastUsedAt: null })
                );
                const { service } = makeService(repo);

                await service.verify(secret);
                await settle();

                expect(touchLastUsed).toHaveBeenCalledWith('token-1', NOW);
            });
        });

        it('resolves without waiting for the touch to finish [api-tokens:I-21]', async () => {
            // The touch is bookkeeping; the request it is authenticating must
            // not pay for it. A never-settling write would hang `verify` if it
            // were awaited, so this test times out rather than passing quietly
            // if the `void` is ever dropped.
            const { repo } = makeRepo(
                recordFrom(baseInsert),
                () => new Promise<void>(() => undefined)
            );
            const { service } = makeService(repo);

            await expect(service.verify(secret)).resolves.toMatchObject({
                id: 'token-1'
            });
        });

        it('still returns the token when the touch rejects [api-tokens:I-21]', async () => {
            // `.catch(() => undefined)` is dead code as far as the rest of this
            // suite knows. Without it a failed `last_used_at` write becomes an
            // unhandled rejection — which, on a host that treats those as
            // fatal, takes the process down over a statistics column.
            const unhandled: unknown[] = [];
            const record = (reason: unknown) => unhandled.push(reason);
            process.on('unhandledRejection', record);
            const { repo } = makeRepo(recordFrom(baseInsert), async () => {
                throw new Error('last_used_at write failed');
            });
            const { service } = makeService(repo);

            try {
                await expect(service.verify(secret)).resolves.toMatchObject({
                    id: 'token-1'
                });
                await new Promise((resolve) => setImmediate(resolve));
                await new Promise((resolve) => setImmediate(resolve));
            } finally {
                process.off('unhandledRejection', record);
            }

            expect(unhandled).toEqual([]);
        });

        it('records api_token.used, in the same transaction as the touch', async () => {
            const { repo } = makeRepo(recordFrom(baseInsert));
            const { service, events } = makeService(repo);

            await service.verify(secret);
            await settle();

            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({
                kind: 'api_token.used',
                aggregateType: 'api_token',
                aggregateId: 'token-1',
                payload: {
                    name: 't',
                    scope: 'read',
                    workspaceIds: ['ws-1', 'ws-2'],
                    lookupPrefix: 'orthacms_sec'
                }
            });
            // A `last_used_at` that moved without a row, or a row claiming a
            // use that rolled back, would each be a small lie in the one place
            // that exists not to tell them.
            expect(committed).toEqual([
                { call: 'repo.touchLastUsed', insideUow: true },
                { call: 'outbox.append', insideUow: true }
            ]);
        });

        it('names no actor — the token is the subject', async () => {
            // Attributing the request to the minting user would credit a person
            // who may have left the company. `api_tokens.created_by` is already
            // where "who minted it" lives.
            const { repo } = makeRepo(recordFrom(baseInsert));
            const { service, events } = makeService(repo);

            await service.verify(secret);
            await settle();

            expect(events[0].payload).not.toHaveProperty('actor');
        });

        it('carries the previous use, which the touch is about to overwrite', async () => {
            // A six-month gap is the interesting number and it is not
            // recoverable from the row afterwards.
            const previous = new Date('2026-01-01T00:00:00.000Z');
            const { repo } = makeRepo(
                recordFrom(baseInsert, { lastUsedAt: previous })
            );
            const { service, events } = makeService(repo);

            await service.verify(secret);
            await settle();

            expect(events[0].payload).toMatchObject({
                previousUseAt: previous
            });
        });

        it('lets no event of any kind carry the secret or its hash [api-tokens:I-01] [identity:I-10]', async () => {
            // `api_tokens` stores only a SHA-256 precisely so that no other
            // table yields a usable credential; `outbox_events` must not become
            // the table that does. Swept across every event the service emits,
            // so a new payload field has to be added deliberately.
            const { repo } = makeRepo(recordFrom(baseInsert));
            const { service, events } = makeService(repo);

            const minted = await service.mint({
                name: 'CI',
                workspaceIds: ['ws-1'],
                scope: 'full',
                createdBy: 'user-1'
            });
            await service.verify(secret);
            await settle();

            expect(events.length).toBeGreaterThanOrEqual(2);
            const serialised = JSON.stringify(events);
            expect(serialised).not.toContain(minted.secret);
            expect(serialised).not.toContain(hashing.hashToken(minted.secret));
            expect(serialised).not.toContain(secret);
            expect(serialised).not.toContain(hashing.hashToken(secret));
        });
    });
});
