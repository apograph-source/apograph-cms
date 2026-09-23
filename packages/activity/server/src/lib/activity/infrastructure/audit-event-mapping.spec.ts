import {
    attachActor,
    createDomainEvent,
    type DomainEvent,
    type EventActor
} from '@orthacms/database';
import { IDENTITY_ACTIVITY_KINDS } from '@orthacms/identity-server';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    AUDIT_KINDS,
    AUDIT_SUBJECT_TYPES,
    AUDITED_EVENT_KINDS,
    toAuditRow,
    UnmappableAuditEventError,
    type AuditRow
} from './audit-event-mapping';

/**
 * Parity safety net (DB-free): for every audited domain event, the row
 * {@link toAuditRow} produces must equal the row the old in-band
 * `recorder.record(...)` wrote for the same action — same
 * `kind`/`subjectType`/`subjectId`/`actorId`/`actorEmail`/`meta`. This is how we
 * prove the outbox subscriber records identically, without standing up e2e.
 */

const EVENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const AT = new Date('2026-07-17T12:00:00.000Z');
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const TARGET_USER_ID = '33333333-3333-4333-8333-333333333333';

/** The acting admin — `attachActor` puts this on the event payload. */
const ACTOR: EventActor = { id: 'actor-1', email: 'admin@example.com' };

/**
 * Builds an event exactly as a producer does: `createDomainEvent` then
 * `attachActor` (the same enrichment the use-cases apply before appending to
 * the outbox).
 */
function event(
    kind: string,
    aggregateType: string,
    aggregateId: string,
    payload: Record<string, unknown>,
    actor: EventActor = ACTOR
): DomainEvent {
    const [enriched] = attachActor(
        [
            createDomainEvent({
                eventId: EVENT_ID,
                kind,
                aggregateType,
                aggregateId,
                occurredAt: AT,
                payload
            })
        ],
        actor
    );
    return enriched;
}

/**
 * The fixed fields shared by every produced row.
 *
 * `actorType` is `'user'` on all of them: `attachActor` defaults it, because
 * until API tokens could act nothing but a person ever could. `workspaceId` is
 * `null` unless the event's own payload names one — the column is filled from
 * `payload.workspaceId`, and most of these kinds belong to no workspace at all.
 */
function base(): Pick<
    AuditRow,
    'id' | 'actorId' | 'actorType' | 'actorEmail' | 'workspaceId' | 'at'
> {
    return {
        id: EVENT_ID,
        actorId: ACTOR.id,
        actorType: 'user',
        actorEmail: ACTOR.email,
        workspaceId: null,
        at: AT
    };
}

/**
 * The **admin's** catalogue, read out of its source file as text.
 *
 * Text rather than an import, and that is the whole point. The admin restates
 * the server's kind strings because it genuinely cannot import a server plugin
 * — the SPA would pull NestJS into its bundle — so something has to keep the
 * two lists in step. An `import` across the package boundary would do it and
 * would also put `@orthacms/activity-admin` in this package's **project
 * graph**: `nx sync` immediately adds a TypeScript project reference, and the
 * audit-log plugin starts depending on a React package. Reading the file
 * creates no such edge.
 *
 * Until now nothing checked this at all. `apps/admin-e2e`'s catalogue suite
 * builds its fixture from the admin's own list, so it proves that list is
 * self-consistent and can never notice the server having moved ahead of it:
 * three `user.sso_*` kinds shipped rendering as raw dotted tokens, absent from
 * the filter, with every test green.
 *
 * The parse is deliberately dumb — every single-quoted literal inside the named
 * `as const` array. It is safe because the file is exactly that shape and holds
 * nothing else, and its failure mode is loud: a reformat that defeats the regex
 * yields an empty list and fails every assertion below rather than passing
 * silently.
 */
function adminCatalogue(name: string): string[] {
    const source = readFileSync(
        join(
            __dirname,
            '../../../../../admin/src/lib/types/activityKinds/index.ts'
        ),
        'utf8'
    );
    const block = new RegExp(
        `export const ${name} = \\[([\\s\\S]*?)\\] as const;`
    ).exec(source);
    if (!block) {
        throw new Error(
            `Could not find "${name}" in the admin's activityKinds module. ` +
                'If it moved, point this test at its new home rather than ' +
                'deleting the check.'
        );
    }
    return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

/** Every audit kind the admin knows how to render. */
const ACTIVITY_KINDS = adminCatalogue('ACTIVITY_KINDS');

/** Every subject type the admin knows how to name. */
const ACTIVITY_SUBJECT_TYPES = adminCatalogue('ACTIVITY_SUBJECT_TYPES');

describe('toAuditRow — event → audit-row parity', () => {
    describe('workspaces (event kind === audit kind)', () => {
        it('workspace.created → { name, slug } against the workspace [activity:I-03]', () => {
            const row = toAuditRow(
                event('workspace.created', 'workspace', WORKSPACE_ID, {
                    name: 'Marketing',
                    slug: 'marketing'
                })
            );
            expect(row).toEqual({
                ...base(),
                kind: IDENTITY_ACTIVITY_KINDS.WORKSPACE_CREATED,
                subjectType: 'workspace',
                subjectId: WORKSPACE_ID,
                meta: { name: 'Marketing', slug: 'marketing' }
            });
        });

        it('workspace.updated → { fields }', () => {
            const row = toAuditRow(
                event('workspace.updated', 'workspace', WORKSPACE_ID, {
                    fields: ['name', 'color']
                })
            );
            expect(row).toMatchObject({
                kind: IDENTITY_ACTIVITY_KINDS.WORKSPACE_UPDATED,
                subjectType: 'workspace',
                subjectId: WORKSPACE_ID,
                meta: { fields: ['name', 'color'] }
            });
        });

        it('workspace.archived → empty meta object (not null) [activity:I-31]', () => {
            const row = toAuditRow(
                event('workspace.archived', 'workspace', WORKSPACE_ID, {})
            );
            expect(row).toEqual({
                ...base(),
                kind: IDENTITY_ACTIVITY_KINDS.WORKSPACE_ARCHIVED,
                subjectType: 'workspace',
                subjectId: WORKSPACE_ID,
                meta: {}
            });
        });

        it('workspace.unarchived → empty meta object', () => {
            const row = toAuditRow(
                event('workspace.unarchived', 'workspace', WORKSPACE_ID, {})
            );
            expect(row).toMatchObject({
                kind: IDENTITY_ACTIVITY_KINDS.WORKSPACE_UNARCHIVED,
                meta: {}
            });
        });

        it('workspace.deleted → { name, slug }', () => {
            const row = toAuditRow(
                event('workspace.deleted', 'workspace', WORKSPACE_ID, {
                    name: 'Marketing',
                    slug: 'marketing'
                })
            );
            expect(row).toMatchObject({
                kind: IDENTITY_ACTIVITY_KINDS.WORKSPACE_DELETED,
                subjectType: 'workspace',
                subjectId: WORKSPACE_ID,
                meta: { name: 'Marketing', slug: 'marketing' }
            });
        });

        it('workspace.member_added → subject is the USER, meta { workspaceId, email } [activity:I-04]', () => {
            const row = toAuditRow(
                event('workspace.member_added', 'workspace', WORKSPACE_ID, {
                    userId: TARGET_USER_ID,
                    email: 'bob@example.com'
                })
            );
            expect(row).toEqual({
                ...base(),
                kind: IDENTITY_ACTIVITY_KINDS.WORKSPACE_MEMBER_ADDED,
                subjectType: 'user',
                subjectId: TARGET_USER_ID,
                meta: { workspaceId: WORKSPACE_ID, email: 'bob@example.com' }
            });
        });

        it('workspace.member_removed → subject is the USER, nullable email [activity:I-13]', () => {
            const row = toAuditRow(
                event('workspace.member_removed', 'workspace', WORKSPACE_ID, {
                    userId: TARGET_USER_ID,
                    email: null
                })
            );
            expect(row).toEqual({
                ...base(),
                kind: IDENTITY_ACTIVITY_KINDS.WORKSPACE_MEMBER_REMOVED,
                subjectType: 'user',
                subjectId: TARGET_USER_ID,
                meta: { workspaceId: WORKSPACE_ID, email: null }
            });
        });

        // covers: activity:I-05
        it.each(['workspace.member_added', 'workspace.member_removed'])(
            '%s refuses a payload with no userId rather than writing an empty subject',
            (kind) => {
                const bad = event(kind, 'workspace', WORKSPACE_ID, {
                    email: 'bob@example.com'
                });
                // `subject_id` is `text NOT NULL`, so `''` inserts cleanly and
                // produces a row naming an action, a workspace and an actor but
                // no subject — unreadable, and unrepairable downstream.
                expect(() => toAuditRow(bad)).toThrow(
                    UnmappableAuditEventError
                );
                expect(() => toAuditRow(bad)).toThrow(/payload\.userId/);
            }
        );

        it('a non-string userId is refused too (not coerced) [activity:I-06]', () => {
            expect(() =>
                toAuditRow(
                    event('workspace.member_added', 'workspace', WORKSPACE_ID, {
                        userId: 12345,
                        email: 'bob@example.com'
                    })
                )
            ).toThrow(UnmappableAuditEventError);
        });

        it('workspace.content_granted → { slug, kind }', () => {
            const row = toAuditRow(
                event('workspace.content_granted', 'workspace', WORKSPACE_ID, {
                    slug: 'blog_post',
                    kind: 'collection'
                })
            );
            expect(row).toMatchObject({
                kind: IDENTITY_ACTIVITY_KINDS.WORKSPACE_CONTENT_GRANTED,
                subjectType: 'workspace',
                subjectId: WORKSPACE_ID,
                meta: { slug: 'blog_post', kind: 'collection' }
            });
        });

        it('workspace.content_revoked → { slug }', () => {
            const row = toAuditRow(
                event('workspace.content_revoked', 'workspace', WORKSPACE_ID, {
                    slug: 'blog_post'
                })
            );
            expect(row).toMatchObject({
                kind: IDENTITY_ACTIVITY_KINDS.WORKSPACE_CONTENT_REVOKED,
                subjectType: 'workspace',
                subjectId: WORKSPACE_ID,
                meta: { slug: 'blog_post' }
            });
        });
    });

    describe('users (member.* → user.*)', () => {
        it('member.invited → user.invited { email } [activity:I-12]', () => {
            const row = toAuditRow(
                event('member.invited', 'member', MEMBER_ID, {
                    email: 'ada@example.com'
                })
            );
            expect(row).toEqual({
                ...base(),
                kind: 'user.invited',
                subjectType: 'user',
                subjectId: MEMBER_ID,
                meta: { email: 'ada@example.com' }
            });
        });

        it('member.invite_resent → user.invite_resent { email }', () => {
            const row = toAuditRow(
                event('member.invite_resent', 'member', MEMBER_ID, {
                    email: 'ada@example.com'
                })
            );
            expect(row).toMatchObject({
                kind: 'user.invite_resent',
                subjectType: 'user',
                subjectId: MEMBER_ID,
                meta: { email: 'ada@example.com' }
            });
        });

        it('member.invite_link_revealed → user.invite_link_revealed { email, mailKind }', () => {
            const row = toAuditRow(
                event('member.invite_link_revealed', 'member', MEMBER_ID, {
                    email: 'ada@example.com',
                    mailKind: 'invite'
                })
            );
            expect(row).toMatchObject({
                kind: 'user.invite_link_revealed',
                subjectType: 'user',
                subjectId: MEMBER_ID,
                // The kind of message, never the link: this table is stamped
                // and never pruned, which is exactly why no secret goes in it.
                meta: { email: 'ada@example.com', mailKind: 'invite' }
            });
        });

        it('member.password_reset_issued → user.password_reset_issued { email }', () => {
            const row = toAuditRow(
                event('member.password_reset_issued', 'member', MEMBER_ID, {
                    email: 'ada@example.com'
                })
            );
            expect(row).toMatchObject({
                kind: 'user.password_reset_issued',
                subjectType: 'user',
                subjectId: MEMBER_ID,
                meta: { email: 'ada@example.com' }
            });
        });

        it('member.removed → user.invite_revoked { email }', () => {
            const row = toAuditRow(
                event('member.removed', 'member', MEMBER_ID, {
                    email: 'ada@example.com'
                })
            );
            expect(row).toMatchObject({
                kind: 'user.invite_revoked',
                subjectType: 'user',
                subjectId: MEMBER_ID,
                meta: { email: 'ada@example.com' }
            });
        });

        it('member.profile_updated → user.profile_updated { name: { from, to } }', () => {
            const row = toAuditRow(
                event('member.profile_updated', 'member', MEMBER_ID, {
                    name: { from: 'Ada', to: 'Ada Lovelace' }
                })
            );
            expect(row).toMatchObject({
                kind: 'user.profile_updated',
                subjectType: 'user',
                subjectId: MEMBER_ID,
                meta: { name: { from: 'Ada', to: 'Ada Lovelace' } }
            });
        });

        it('member.role_changed → user.role_changed { from, to }', () => {
            const row = toAuditRow(
                event('member.role_changed', 'member', MEMBER_ID, {
                    from: 'editor',
                    to: 'admin'
                })
            );
            expect(row).toMatchObject({
                kind: 'user.role_changed',
                subjectType: 'user',
                subjectId: MEMBER_ID,
                meta: { from: 'editor', to: 'admin' }
            });
        });

        it('member.disabled → user.suspended, null meta', () => {
            const row = toAuditRow(
                event('member.disabled', 'member', MEMBER_ID, {})
            );
            expect(row).toEqual({
                ...base(),
                kind: 'user.suspended',
                subjectType: 'user',
                subjectId: MEMBER_ID,
                meta: null
            });
        });

        it('member.reactivated → user.reactivated, null meta', () => {
            const row = toAuditRow(
                event('member.reactivated', 'member', MEMBER_ID, {})
            );
            expect(row).toEqual({
                ...base(),
                kind: 'user.reactivated',
                subjectType: 'user',
                subjectId: MEMBER_ID,
                meta: null
            });
        });
    });

    describe('identity (auth.* → user.*, actor is the signer)', () => {
        it('auth.signed_in → user.signed_in, actor = the user [activity:I-12]', () => {
            const row = toAuditRow(
                event(
                    'auth.signed_in',
                    'user',
                    TARGET_USER_ID,
                    {},
                    {
                        id: TARGET_USER_ID,
                        email: 'me@example.com'
                    }
                )
            );
            expect(row).toEqual({
                id: EVENT_ID,
                kind: IDENTITY_ACTIVITY_KINDS.USER_SIGNED_IN,
                subjectType: 'user',
                subjectId: TARGET_USER_ID,
                actorId: TARGET_USER_ID,
                actorType: 'user',
                workspaceId: null,
                actorEmail: 'me@example.com',
                // Where the sign-in came from. Both are null on an event that
                // carried no session context — "not captured", which a reader
                // should be able to tell from "not looked at".
                meta: { ipAddress: null, userAgent: null },
                at: AT
            });
        });

        it('user.password_changed → an audit row carrying the eviction count', () => {
            // BUG-identity-server-05: identity's aggregate raised this event
            // from the start, but no mapper existed, so a credential rotation
            // left the audit log completely silent.
            const row = toAuditRow(
                event(
                    'user.password_changed',
                    'user',
                    TARGET_USER_ID,
                    { sessionsRevoked: 3 },
                    { id: TARGET_USER_ID, email: 'me@example.com' }
                )
            );
            expect(row).toEqual({
                id: EVENT_ID,
                kind: 'user.password_changed',
                subjectType: 'user',
                subjectId: TARGET_USER_ID,
                actorId: TARGET_USER_ID,
                actorType: 'user',
                workspaceId: null,
                actorEmail: 'me@example.com',
                meta: { sessionsRevoked: 3 },
                at: AT
            });
        });

        it('records a password change that evicted nothing as a zero, not a gap', () => {
            const row = toAuditRow(
                event(
                    'user.password_changed',
                    'user',
                    TARGET_USER_ID,
                    { sessionsRevoked: 0 },
                    { id: TARGET_USER_ID, email: 'me@example.com' }
                )
            );
            expect(row?.meta).toEqual({ sessionsRevoked: 0 });
        });

        it('user.activated → the account gained a credential, distinct from the sign-in', () => {
            // `accept-invite.use-case.ts` appends `user.activated` and
            // `auth.signed_in` together. Only the sign-in was mapped, so the
            // trail said an invited person signed in and never that the account
            // went `pending` → `active`. Verified live under ORT-42: two
            // dispatched outbox rows, one audit row.
            const row = toAuditRow(
                event(
                    'user.activated',
                    'user',
                    TARGET_USER_ID,
                    {},
                    { id: TARGET_USER_ID, email: 'invited@example.com' }
                )
            );
            expect(row).toEqual({
                id: EVENT_ID,
                kind: 'user.activated',
                subjectType: 'user',
                subjectId: TARGET_USER_ID,
                actorId: TARGET_USER_ID,
                actorType: 'user',
                workspaceId: null,
                actorEmail: 'invited@example.com',
                meta: null,
                at: AT
            });
        });

        it('auth.signed_out → user.signed_out (actorEmail may be null)', () => {
            const row = toAuditRow(
                event(
                    'auth.signed_out',
                    'user',
                    TARGET_USER_ID,
                    {},
                    {
                        id: TARGET_USER_ID,
                        email: null
                    }
                )
            );
            expect(row).toEqual({
                id: EVENT_ID,
                kind: IDENTITY_ACTIVITY_KINDS.USER_SIGNED_OUT,
                subjectType: 'user',
                subjectId: TARGET_USER_ID,
                actorId: TARGET_USER_ID,
                actorType: 'user',
                workspaceId: null,
                actorEmail: null,
                meta: null,
                at: AT
            });
        });

        it('keeps how a sign-out happened when the provider ended it', () => {
            // A back-channel logout is the directory terminating the session —
            // an offboarding, a compromised account, a revoked licence. The
            // person did not click anything.
            //
            // `sso-backchannel-logout.use-case.ts` puts the method and the
            // provider in the payload precisely so the trail can say so, and
            // dropping them makes a forced sign-out indistinguishable from
            // somebody closing their own session. `auth.signed_in` records the
            // same pair for the same reason — the asymmetry was the bug.
            const row = toAuditRow(
                event(
                    'auth.signed_out',
                    'user',
                    TARGET_USER_ID,
                    { method: 'sso_backchannel', provider: 'keycloak' },
                    { id: TARGET_USER_ID, email: 'linked@example.com' }
                )
            );

            expect(row?.meta).toEqual({
                method: 'sso_backchannel',
                provider: 'keycloak'
            });
        });

        it('says nothing about the method when the person signed out themselves', () => {
            // The ordinary path carries no method, and inventing one would be
            // worse than silence: `meta` stays null so "not recorded" and
            // "recorded as ordinary" cannot be confused.
            const row = toAuditRow(
                event('auth.signed_out', 'user', TARGET_USER_ID, {}, ACTOR)
            );

            expect(row?.meta).toBeNull();
        });
    });

    describe('API token lifecycle', () => {
        const TOKEN_ID = '99999999-9999-4999-8999-999999999999';

        it('api_token.created → token.created on an api_token subject [activity:I-12]', () => {
            const row = toAuditRow(
                event(
                    'api_token.created',
                    'api_token',
                    TOKEN_ID,
                    {
                        name: 'CI',
                        scope: 'read',
                        workspaceIds: [WORKSPACE_ID],
                        lookupPrefix: 'orthacms_abc123',
                        expiresAt: null
                    },
                    { id: TARGET_USER_ID, email: 'admin@example.com' }
                )
            );
            expect(row).toEqual({
                id: EVENT_ID,
                kind: 'token.created',
                subjectType: 'api_token',
                subjectId: TOKEN_ID,
                actorId: TARGET_USER_ID,
                actorType: 'user',
                workspaceId: null,
                actorEmail: 'admin@example.com',
                meta: {
                    name: 'CI',
                    scope: 'read',
                    workspaceIds: [WORKSPACE_ID],
                    lookupPrefix: 'orthacms_abc123'
                },
                at: AT
            });
        });

        it('api_token.revoked → token.revoked, same shape', () => {
            const row = toAuditRow(
                event(
                    'api_token.revoked',
                    'api_token',
                    TOKEN_ID,
                    {
                        name: 'CI',
                        scope: 'full',
                        workspaceIds: [WORKSPACE_ID],
                        lookupPrefix: 'orthacms_abc123'
                    },
                    { id: TARGET_USER_ID, email: 'admin@example.com' }
                )
            );
            expect(row).toMatchObject({
                kind: 'token.revoked',
                subjectType: 'api_token',
                subjectId: TOKEN_ID,
                meta: {
                    name: 'CI',
                    scope: 'full',
                    lookupPrefix: 'orthacms_abc123'
                }
            });
        });

        it('never carries a secret or a hash into the audit row [activity:I-08]', () => {
            // The mapper projects a fixed field set, so even a producer that
            // over-shares cannot leak a credential into the log — `api_tokens`
            // stores only a SHA-256 for exactly this reason, and the audit
            // table must not become the second copy.
            const row = toAuditRow(
                event('api_token.created', 'api_token', TOKEN_ID, {
                    name: 'CI',
                    scope: 'read',
                    workspaceIds: [],
                    lookupPrefix: 'orthacms_abc123',
                    secret: 'orthacms_the-actual-secret',
                    tokenHash: 'f'.repeat(64)
                })
            );
            expect(Object.keys(row?.meta ?? {}).sort()).toEqual([
                'lookupPrefix',
                'name',
                'scope',
                'workspaceIds'
            ]);
            expect(JSON.stringify(row)).not.toContain('the-actual-secret');
            expect(JSON.stringify(row)).not.toContain('f'.repeat(64));
        });
    });

    describe('content entry lifecycle', () => {
        it('maps a publish to a content_entry row carrying its type', () => {
            const row = toAuditRow(
                event('entry.published', 'content_entry', WORKSPACE_ID, {
                    contentType: 'article'
                })
            );
            expect(row).toMatchObject({
                kind: 'entry.published',
                subjectType: 'content_entry',
                subjectId: WORKSPACE_ID,
                meta: { contentType: 'article' }
            });
        });

        it('maps an unpublish the same way', () => {
            const row = toAuditRow(
                event('entry.unpublished', 'content_entry', WORKSPACE_ID, {
                    contentType: 'article'
                })
            );
            expect(row).toMatchObject({
                kind: 'entry.unpublished',
                subjectType: 'content_entry',
                meta: { contentType: 'article' }
            });
        });
    });

    describe('media library (event kind === audit kind)', () => {
        const ASSET_ID = '44444444-4444-4444-8444-444444444444';
        const FOLDER_ID = '55555555-5555-4555-8555-555555555555';

        it('media.asset.uploaded → media_asset subject, payload minus actor [activity:I-12]', () => {
            const row = toAuditRow(
                event('media.asset.uploaded', 'media.asset', ASSET_ID, {
                    name: 'hero.png',
                    kind: 'image',
                    folderId: null
                })
            );
            expect(row).toEqual({
                ...base(),
                kind: 'media.asset.uploaded',
                subjectType: 'media_asset',
                subjectId: ASSET_ID,
                meta: { name: 'hero.png', kind: 'image', folderId: null }
            });
        });

        it('media.asset.updated carries only the field that changed', () => {
            expect(
                toAuditRow(
                    event('media.asset.updated', 'media.asset', ASSET_ID, {
                        alt: 'A hero image'
                    })
                )
            ).toMatchObject({
                kind: 'media.asset.updated',
                subjectType: 'media_asset',
                subjectId: ASSET_ID,
                meta: { alt: 'A hero image' }
            });
        });

        it('media.asset.moved records the destination folder', () => {
            expect(
                toAuditRow(
                    event('media.asset.moved', 'media.asset', ASSET_ID, {
                        folderId: FOLDER_ID
                    })
                )
            ).toMatchObject({
                kind: 'media.asset.moved',
                subjectId: ASSET_ID,
                meta: { folderId: FOLDER_ID }
            });
        });

        it('media.asset.deleted keeps the storage key — the blob-GC seam', () => {
            expect(
                toAuditRow(
                    event('media.asset.deleted', 'media.asset', ASSET_ID, {
                        storageKey: 'ws/asset/hero.png',
                        storageProvider: 'local'
                    })
                )
            ).toMatchObject({
                kind: 'media.asset.deleted',
                subjectType: 'media_asset',
                meta: {
                    storageKey: 'ws/asset/hero.png',
                    storageProvider: 'local'
                }
            });
        });

        it('media.folder.created → media_folder subject', () => {
            expect(
                toAuditRow(
                    event('media.folder.created', 'media.folder', FOLDER_ID, {
                        name: 'Campaign',
                        parentId: null
                    })
                )
            ).toEqual({
                ...base(),
                kind: 'media.folder.created',
                subjectType: 'media_folder',
                subjectId: FOLDER_ID,
                meta: { name: 'Campaign', parentId: null }
            });
        });

        it('media.folder.renamed → media_folder subject, { name }', () => {
            expect(
                toAuditRow(
                    event('media.folder.renamed', 'media.folder', FOLDER_ID, {
                        name: 'Campaign 2026'
                    })
                )
            ).toMatchObject({
                kind: 'media.folder.renamed',
                subjectType: 'media_folder',
                meta: { name: 'Campaign 2026' }
            });
        });

        it('media.folder.deleted → media_folder subject, empty meta', () => {
            expect(
                toAuditRow(
                    event('media.folder.deleted', 'media.folder', FOLDER_ID, {})
                )
            ).toMatchObject({
                kind: 'media.folder.deleted',
                subjectType: 'media_folder',
                subjectId: FOLDER_ID,
                meta: {}
            });
        });

        it('never repeats the actor inside meta — it owns two columns already [activity:I-07]', () => {
            const row = toAuditRow(
                event('media.asset.uploaded', 'media.asset', ASSET_ID, {
                    name: 'hero.png'
                })
            );
            expect(row?.meta).not.toHaveProperty('actor');
            expect(row?.actorId).toBe(ACTOR.id);
            expect(row?.actorEmail).toBe(ACTOR.email);
        });

        it('folds the actor’s `via` into meta without displacing it [activity:I-07]', () => {
            const row = toAuditRow(
                event(
                    'media.asset.uploaded',
                    'media.asset',
                    ASSET_ID,
                    { name: 'hero.png' },
                    { ...ACTOR, via: { kind: 'copilot', runId: 'run-1' } }
                )
            );

            // `via` is the one part of the actor that lands in `meta` — *how*,
            // not *who* — and it is **merged**, not substituted. A copilot-applied
            // upload is still an upload, and a reader wants the file's name and
            // the run that produced it. Replacing rather than merging is the
            // failure this pins: the row would keep its provenance and lose
            // everything the kind itself recorded.
            expect(row?.meta).toEqual({
                name: 'hero.png',
                via: { kind: 'copilot', runId: 'run-1' }
            });

            // And it is still not a second copy of the actor.
            expect(row?.meta).not.toHaveProperty('actor');
            expect(row?.actorId).toBe(ACTOR.id);
        });

        it('leaves meta untouched when the action was performed by hand [activity:I-07]', () => {
            // The control: an ordinary row carries no `via` key at all, rather
            // than a null one. Most rows are this one.
            const row = toAuditRow(
                event('media.asset.uploaded', 'media.asset', ASSET_ID, {
                    name: 'hero.png'
                })
            );
            expect(row?.meta).toEqual({ name: 'hero.png' });
        });
    });

    /**
     * `actor_type` is null **if and only if** `actor_id` is.
     *
     * One direction is already pinned everywhere: `base()` fixes `actorType` to
     * `'user'` for an actor that declares no kind, so every row above asserts
     * the default. The other direction had nothing — an unactored row that
     * still claimed `'user'` would say a person performed something nobody did,
     * and no `toEqual` in this file drives an event with no actor on it.
     */
    describe('the actor columns move together', () => {
        /** An event as it leaves an aggregate: no `attachActor`, so no actor. */
        function unactored(kind: string): DomainEvent {
            return createDomainEvent({
                eventId: EVENT_ID,
                kind,
                aggregateType: 'workspace',
                aggregateId: WORKSPACE_ID,
                occurredAt: AT,
                payload: {}
            });
        }

        it('claims no principal at all when the event names none [activity:I-31]', () => {
            const row = toAuditRow(unactored('workspace.archived'));

            expect(row).toMatchObject({
                actorId: null,
                actorType: null,
                actorEmail: null
            });
        });

        it('reads a kindless actor as a person [activity:I-31]', () => {
            // The default is a statement of fact rather than a guess: nothing
            // but a person could act before `attachActor` carried a type.
            const row = toAuditRow(
                event(
                    'workspace.archived',
                    'workspace',
                    WORKSPACE_ID,
                    {},
                    {
                        id: 'actor-1',
                        email: 'admin@example.com'
                    }
                )
            );

            expect(row).toMatchObject({
                actorId: 'actor-1',
                actorType: 'user'
            });
        });

        it('keeps a credential’s own kind rather than defaulting it [activity:I-31]', () => {
            // The case the default must not swallow. A token-authored write
            // recorded as `'user'` names a person who did not do it — the exact
            // defect `actor_type` was added to end.
            const row = toAuditRow(
                event(
                    'workspace.archived',
                    'workspace',
                    WORKSPACE_ID,
                    {},
                    {
                        id: 'token-1',
                        email: null,
                        type: 'api_token',
                        label: 'CI publisher'
                    }
                )
            );

            expect(row).toMatchObject({
                actorId: 'token-1',
                actorType: 'api_token',
                // A token has no address, so its label is what makes the row
                // readable; the column is the same one either way.
                actorEmail: 'CI publisher'
            });
        });
    });

    describe('non-audited kinds', () => {
        it('returns null for an unmapped kind [activity:I-05]', () => {
            expect(
                toAuditRow(
                    event(
                        'workspace.something_else',
                        'workspace',
                        WORKSPACE_ID,
                        {}
                    )
                )
            ).toBeNull();
        });

        /**
         * The whole-catalogue check. An event kind with no mapper is not an
         * error anywhere at runtime — the dispatcher finds no subscriber,
         * stamps the row dispatched, and the action is silently unaudited. This
         * list is the only place that omission is visible, so it is pinned
         * exhaustively rather than sampled.
         */
        it('audits exactly the 69 expected kinds', () => {
            expect([...AUDITED_EVENT_KINDS].sort()).toEqual(
                [
                    'alarm.rule.created',
                    'alarm.rule.deleted',
                    'alarm.rule.rescanned',
                    'alarm.rule.updated',
                    'api_token.created',
                    'api_token.revoked',
                    'api_token.used',
                    'auth.sign_in_failed',
                    'auth.signed_in',
                    'auth.signed_out',
                    'copilot.skill.created',
                    'copilot.skill.deleted',
                    'copilot.skill.updated',
                    'copilot.tool_permission.decided',
                    'media.asset.deleted',
                    'media.asset.moved',
                    'media.asset.updated',
                    'media.asset.uploaded',
                    'media.folder.created',
                    'media.folder.deleted',
                    'media.folder.renamed',
                    'outbox.event_retried',
                    'protection.rule_changed',
                    'entry.publish_bypassed',
                    'review.approved',
                    'review.changes_requested',
                    'review.requested',
                    'saved_view.created',
                    'saved_view.deleted',
                    'saved_view.updated',
                    'segment.created',
                    'segment.deleted',
                    'segment.entry_access_changed',
                    'segment.updated',
                    'transfer.content.exported',
                    'transfer.content.imported',
                    'user.activated',
                    'user.disabled',
                    'user.enabled',
                    'user.password_changed',
                    'user.session_revoked',
                    'user.sso_linked',
                    'user.sso_provisioned',
                    'user.sso_role_mapped',
                    'entry.created',
                    'entry.deleted',
                    'entry.published',
                    'entry.purged',
                    'entry.restored',
                    'entry.unpublished',
                    'entry.updated',
                    'member.disabled',
                    'member.invite_link_revealed',
                    'member.invite_resent',
                    'member.invited',
                    'member.password_reset_issued',
                    'member.profile_updated',
                    'member.reactivated',
                    'member.removed',
                    'member.role_changed',
                    'workspace.archived',
                    'workspace.content_granted',
                    'workspace.content_revoked',
                    'workspace.created',
                    'workspace.deleted',
                    'workspace.member_added',
                    'workspace.member_removed',
                    'workspace.unarchived',
                    'workspace.updated'
                ].sort()
            );
        });
    });

    /**
     * The catalogue, in both directions.
     *
     * `AUDIT_KINDS` and `AUDIT_SUBJECT_TYPES` are declared by hand — deriving
     * them would mean running every mapper, and several legitimately throw on a
     * payload that cannot name their subject — so something has to prove the
     * declaration matches what the mappers actually emit. That is what this
     * does: it drives **every** mapper once, with a payload rich enough to
     * satisfy the ones that refuse, and checks the produced kind and subject
     * type are declared, then checks nothing declared is unreachable.
     */
    describe('the produced catalogue', () => {
        /**
         * A payload carrying every field any mapper reads. One bag for all of
         * them, so adding a mapper needs no fixture of its own unless it reads
         * something genuinely new — and if it does, the `throw` it raises here
         * is the failure, which is the right outcome.
         */
        const RICH_PAYLOAD: Record<string, unknown> = {
            userId: TARGET_USER_ID,
            email: 'someone@example.com',
            name: 'a name',
            slug: 'a-slug',
            kind: 'a-kind',
            from: 'a',
            to: 'b',
            fields: ['title'],
            contentType: 'article',
            title: 'An article',
            workspaceId: WORKSPACE_ID,
            provider: 'google',
            role: 'editor',
            scope: 'read',
            workspaceIds: [WORKSPACE_ID],
            lookupPrefix: 'orthacms_abc123',
            sessionsRevoked: 1,
            sessionId: 'session-1',
            method: 'password',
            reason: 'bad_password',
            soft: true,
            callId: 'call-1',
            decision: 'allow'
        };

        function rowFor(kind: string): AuditRow {
            const row = toAuditRow(
                event(kind, 'whatever', TARGET_USER_ID, RICH_PAYLOAD)
            );
            if (!row) throw new Error(`No row produced for "${kind}".`);
            return row;
        }

        it('produces only kinds the catalogue declares', () => {
            const produced = new Set(
                AUDITED_EVENT_KINDS.map((kind) => rowFor(kind).kind)
            );
            const undeclared = [...produced].filter(
                (kind) => !(AUDIT_KINDS as readonly string[]).includes(kind)
            );
            // Compared as a joined string rather than an array: jest prints
            // the whole diff either way, but this puts the offending kinds in
            // the assertion's own message, which is the line a reader sees
            // first.
            expect(`emitted but not declared: ${undeclared.join(', ')}`).toBe(
                'emitted but not declared: '
            );
        });

        it('declares no kind no mapper can emit [activity:I-34]', () => {
            const produced = new Set(
                AUDITED_EVENT_KINDS.map((kind) => rowFor(kind).kind)
            );
            const unreachable = AUDIT_KINDS.filter(
                (kind) => !produced.has(kind)
            );
            expect(`declared but unreachable: ${unreachable.join(', ')}`).toBe(
                'declared but unreachable: '
            );
        });

        /**
         * The collapse, named rather than counted.
         *
         * 69 mappers produce 67 kinds, and the two-kind difference is a
         * decision: `user.disabled`/`user.enabled` (the identity aggregate's
         * own pair) land on the same audit kinds as
         * `member.disabled`/`member.reactivated`, because which aggregate
         * suspended the account is an internal fact and the reader wants "this
         * account was suspended".
         *
         * Every other collapse would be a bug — two distinct actions rendering
         * as one row a reader cannot tell apart — and none of the checks above
         * can see one: they are set-membership tests, and a mapper wrongly
         * emitting a kind another mapper already emits is a member of the set
         * either way. So the collisions are asserted **by name**, not by count:
         * a third one fails here with the pair that caused it in the message.
         */
        it('collapses 69 event kinds onto 67, and only where it means to [activity:I-11]', () => {
            const sourcesByAuditKind = new Map<string, string[]>();
            for (const eventKind of AUDITED_EVENT_KINDS) {
                const produced = rowFor(eventKind).kind;
                sourcesByAuditKind.set(produced, [
                    ...(sourcesByAuditKind.get(produced) ?? []),
                    eventKind
                ]);
            }

            const collisions = [...sourcesByAuditKind]
                .filter(([, sources]) => sources.length > 1)
                .map(
                    ([auditKind, sources]) =>
                        `${auditKind} ← ${[...sources].sort().join(' + ')}`
                )
                .sort();

            expect(collisions).toEqual([
                'user.reactivated ← member.reactivated + user.enabled',
                'user.suspended ← member.disabled + user.disabled'
            ]);

            // The arithmetic the invariant states, which the list above only
            // implies: 69 mappers, two collisions, 67 distinct kinds.
            expect(AUDITED_EVENT_KINDS).toHaveLength(69);
            expect(sourcesByAuditKind.size).toBe(67);
        });

        it('stamps only subject types the catalogue declares', () => {
            const produced = new Set(
                AUDITED_EVENT_KINDS.map((kind) => rowFor(kind).subjectType)
            );
            const undeclared = [...produced].filter(
                (type) =>
                    !(AUDIT_SUBJECT_TYPES as readonly string[]).includes(type)
            );
            expect(undeclared).toEqual([]);
        });
    });

    /**
     * The **admin** side of the same catalogue.
     *
     * This is the check that was missing. `apps/admin-e2e`'s
     * `activity-kinds.spec.ts` pins every kind the admin lists — against a
     * fixture built from the admin's own list, so it proves the list is
     * self-consistent and can never notice the server having moved ahead of it.
     * That is exactly how three `user.sso_*` kinds shipped rendering as raw
     * dotted tokens with no filter entry.
     *
     * The admin cannot import a server plugin, so it restates these strings.
     * A **test** can read both, because the admin's catalogue module imports
     * nothing at all — see the fixture's own note.
     */
    describe('the admin catalogue', () => {
        it('lists every kind the server can produce [activity:I-34]', () => {
            const missing = AUDIT_KINDS.filter(
                (kind) => !ACTIVITY_KINDS.includes(kind)
            );
            expect(`rendered as raw wire tokens: ${missing.join(', ')}`).toBe(
                'rendered as raw wire tokens: '
            );
        });

        it('lists no kind the server cannot produce [activity:I-34]', () => {
            const extra = ACTIVITY_KINDS.filter(
                (kind) => !(AUDIT_KINDS as readonly string[]).includes(kind)
            );
            expect(`dead labels: ${extra.join(', ')}`).toBe('dead labels: ');
        });

        it('names every subject type the server can stamp', () => {
            const missing = AUDIT_SUBJECT_TYPES.filter(
                (type) => !ACTIVITY_SUBJECT_TYPES.includes(type)
            );
            expect(missing).toEqual([]);
        });
    });

    /**
     * The check the other two cannot make.
     *
     * Everything above compares the audit catalogue against itself and against
     * the admin's copy of it — so it can only ever notice a kind this mapper
     * already knows about. The failure this package actually has is the other
     * direction: a plugin starts raising a **new** event kind, no mapper
     * matches it, `toAuditRow` returns null, the dispatcher stamps the row
     * delivered, and that action is missing from the trail forever with
     * nothing going red anywhere.
     *
     * It has happened four times — API tokens, entry publishes, the whole media
     * library, and content export/import — and each time it was found by a
     * person looking for a row that was not there.
     *
     * So this reads the producers' own catalogues, as text (no import, and
     * therefore no project-graph edge from this package to nine others), and
     * asserts every kind they declare has somewhere to land. Adding an event
     * kind and forgetting the mapper now fails here instead of going quiet.
     */
    describe('every kind a plugin can raise has a mapper', () => {
        /** The `*-events.ts` catalogues, relative to this spec. */
        const PRODUCERS = [
            '../../../../../../alarms/server/src/lib/alarms.events.ts',
            '../../../../../../content/server/src/lib/entries/domain/events/entry-events.ts',
            '../../../../../../content/server/src/lib/views/domain/events/saved-view-events.ts',
            '../../../../../../copilot/server/src/lib/copilot.events.ts',
            '../../../../../../identity/server/src/lib/domain/events/identity-events.ts',
            '../../../../../../media/server/src/lib/domain/events/media-events.ts',
            '../../../../../../segments/server/src/lib/segments.events.ts',
            '../../../../../../transfer/server/src/lib/transfer.events.ts',
            '../../../../../../users/server/src/lib/member/domain/events/member-events.ts',
            '../../../../../../workspaces/server/src/lib/workspace/domain/events/workspace-events.ts'
        ];

        /**
         * Every event kind a producer declares.
         *
         * Read from the `*_EVENT_KINDS` object rather than from the file at
         * large, because an events module also holds `aggregateType` literals
         * of the same shape (`media.asset` beside `media.asset.uploaded`).
         * Sweeping those in would force them onto the "deliberately not
         * audited" list, which would be a false statement about them: they are
         * not kinds at all.
         *
         * Under-reading is the failure this check exists to prevent, so a file
         * that cannot be read, or one whose catalogue the pattern no longer
         * matches, is an error rather than an empty list.
         */
        function declaredKinds(): string[] {
            const kinds = new Set<string>();
            for (const relative of PRODUCERS) {
                const path = join(__dirname, relative);
                if (!existsSync(path)) {
                    throw new Error(
                        `Event catalogue "${relative}" is not where this test ` +
                            'expects it. Point the test at its new home rather ' +
                            'than deleting the entry — an unreadable producer ' +
                            'is exactly the silence this check exists to break.'
                    );
                }
                const source = readFileSync(path, 'utf8');
                const blocks = [
                    ...source.matchAll(
                        /export const [A-Z_]*EVENT_KINDS[^=]*= \{([\s\S]*?)\} as const;/g
                    )
                ];
                if (!blocks.length) {
                    throw new Error(
                        `No "*_EVENT_KINDS" catalogue found in "${relative}". ` +
                            'If the declaration changed shape, teach this test ' +
                            'the new one — a producer that reads as empty ' +
                            'passes the check below while proving nothing.'
                    );
                }
                for (const [, body] of blocks) {
                    for (const [, kind] of body.matchAll(
                        /'([a-z_]+\.[a-z_.]+)'/g
                    )) {
                        kinds.add(kind);
                    }
                }
            }
            return [...kinds].sort();
        }

        /**
         * Kinds that are raised and deliberately **not** audited.
         *
         * Empty today, and that is the point of listing it: a kind arriving
         * here is a decision somebody made on purpose and can be read back,
         * rather than an omission nobody can tell from one.
         */
        const NOT_AUDITED: readonly string[] = [];

        it('leaves no raised kind without somewhere to land', () => {
            const unmapped = declaredKinds().filter(
                (kind) =>
                    !AUDITED_EVENT_KINDS.includes(kind) &&
                    !NOT_AUDITED.includes(kind)
            );

            // Named in the message rather than counted: the point of failing is
            // to say which kind goes unrecorded.
            expect(`unmapped: ${unmapped.join(', ')}`).toBe('unmapped: ');
        });

        it('reads the producers at all', () => {
            // The guard on the guard. A regex defeated by a reformat would
            // yield an empty list, and an empty list passes the check above
            // while proving nothing.
            expect(declaredKinds().length).toBeGreaterThan(40);
        });
    });
});
