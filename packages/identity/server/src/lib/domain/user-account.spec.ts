import type { DomainEvent } from '@orthacms/database';
import { UserAccount } from './user-account';
import { PasswordHash } from './value-objects/password-hash';
import { IDENTITY_EVENT_KINDS } from './events/identity-events';
import {
    InvalidEmailError,
    InvalidUserIdError,
    InvalidUserStateError,
    InvalidUserStatusError
} from './errors';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const HASH = PasswordHash.create('$2b$12$abcdefghijklmnopqrstuv');

/** A loaded account with the given status (active with a credential by default). */
function rehydrated(
    overrides: { status?: string; passwordHash?: string | null } = {}
): UserAccount {
    return UserAccount.rehydrate({
        id: USER_ID,
        email: 'ada@example.com',
        status: overrides.status ?? 'active',
        passwordHash:
            overrides.passwordHash === undefined
                ? '$2b$12$abcdefghijklmnopqrstuv'
                : overrides.passwordHash
    });
}

/** A loaded `pending` account: an invite nobody has accepted yet. */
function pendingAccount(): UserAccount {
    return rehydrated({ status: 'pending', passwordHash: null });
}

/** The identifying parts of an event, minus the per-instance id and clock. */
function fact(event: DomainEvent) {
    return {
        kind: event.kind,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload
    };
}

describe('UserAccount aggregate', () => {
    describe('activate', () => {
        it('activates a pending account, sets the credential, raises user.activated', () => {
            const account = rehydrated({
                status: 'pending',
                passwordHash: null
            });
            account.activate(HASH);

            expect(account.status.value).toBe('active');
            expect(account.passwordHash?.value).toBe(HASH.value);
            expect(account.changes()).toEqual({
                statusChanged: true,
                credentialChanged: true
            });
            expect(account.pullEvents().map((event) => event.kind)).toEqual([
                IDENTITY_EVENT_KINDS.USER_ACTIVATED
            ]);
        });

        it('rejects activating a non-pending account', () => {
            const account = rehydrated({ status: 'active' });
            expect(() => account.activate(HASH)).toThrow(InvalidUserStateError);
        });
    });

    /**
     * The SSO acceptance path. An identity provider vouched for the
     * address, so there is no password to set — and the missing hash is the
     * point, not an omission: it is what makes the password path refuse the
     * account exactly as it refuses an unaccepted invite, leaving the provider
     * as the only way in. A `credentialChanged` here would have the repository
     * write a credential nobody chose.
     *
     * Not a test of the identity dossier's I-22, though it was once labelled
     * one: I-22 governs a first SSO sign-in *claiming an existing account*
     * (only with `emailVerified`, `pending` and `disabled` refused), and this
     * aggregate never sees `emailVerified` — `pending` is the accepted case
     * here, not a refused one. I-22 is pinned in
     * `application/use-cases/complete-sso.use-case.spec.ts` and
     * `apps/server-e2e/src/server/auth/sso.spec.ts`.
     */
    describe('activateWithoutCredential', () => {
        it('activates a pending account and leaves it without a credential', () => {
            const account = pendingAccount();
            account.activateWithoutCredential();

            expect(account.status.value).toBe('active');
            expect(account.passwordHash).toBeNull();
            expect(account.changes()).toEqual({
                statusChanged: true,
                credentialChanged: false
            });
            expect(account.pullEvents().map((event) => event.kind)).toEqual([
                IDENTITY_EVENT_KINDS.USER_ACTIVATED
            ]);
        });

        it.each(['active', 'disabled'])(
            'rejects activating a %s account',
            (status) => {
                const account = rehydrated({ status });
                expect(() => account.activateWithoutCredential()).toThrow(
                    InvalidUserStateError
                );
            }
        );

        it('leaves a rejected account exactly as it was', () => {
            const account = rehydrated({ status: 'disabled' });
            expect(() => account.activateWithoutCredential()).toThrow(
                InvalidUserStateError
            );

            expect(account.status.value).toBe('disabled');
            expect(account.changes()).toEqual({
                statusChanged: false,
                credentialChanged: false
            });
            expect(account.pullEvents()).toEqual([]);
        });

        // What changed about the *account* is identical either way, so the two
        // paths raise one fact; how it happened rides on the sign-in event
        // beside it. A subscriber must not have to know which path ran.
        it('raises the same user.activated fact as the password path', () => {
            const credentialled = pendingAccount();
            credentialled.activate(HASH);
            const vouchedFor = pendingAccount();
            vouchedFor.activateWithoutCredential();

            expect(vouchedFor.pullEvents().map(fact)).toEqual(
                credentialled.pullEvents().map(fact)
            );
        });
    });

    describe('disable', () => {
        it('disables an active account and raises user.disabled', () => {
            const account = rehydrated();
            account.disable();
            expect(account.status.value).toBe('disabled');
            expect(account.changes().statusChanged).toBe(true);
            expect(account.pullEvents()[0].kind).toBe(
                IDENTITY_EVENT_KINDS.USER_DISABLED
            );
        });

        it('rejects disabling a non-active account', () => {
            const account = rehydrated({
                status: 'pending',
                passwordHash: null
            });
            expect(() => account.disable()).toThrow(InvalidUserStateError);
        });
    });

    describe('enable', () => {
        it('re-enables a disabled account and raises user.enabled', () => {
            const account = rehydrated({ status: 'disabled' });
            account.enable();
            expect(account.status.value).toBe('active');
            expect(account.pullEvents()[0].kind).toBe(
                IDENTITY_EVENT_KINDS.USER_ENABLED
            );
        });

        it('rejects enabling a non-disabled account', () => {
            const account = rehydrated({ status: 'active' });
            expect(() => account.enable()).toThrow(InvalidUserStateError);
        });
    });

    describe('changeCredential', () => {
        it('changes the credential of an active account and raises user.password_changed', () => {
            const account = rehydrated();
            const next = PasswordHash.create('$2b$12$zzzzzzzzzzzzzzzzzzzzzz');
            account.changeCredential(next);
            expect(account.passwordHash?.value).toBe(next.value);
            expect(account.changes().credentialChanged).toBe(true);
            expect(account.pullEvents()[0].kind).toBe(
                IDENTITY_EVENT_KINDS.PASSWORD_CHANGED
            );
        });

        // The method gates on `disabled` alone, deliberately: a pending
        // account is how an invite acceptance and a reset-before-acceptance
        // set a first credential. It must not activate the account as a side
        // effect — that transition belongs to `activate`.
        it('changes the credential of a pending account without activating it', () => {
            const account = pendingAccount();
            account.changeCredential(HASH);

            expect(account.status.value).toBe('pending');
            expect(account.passwordHash?.value).toBe(HASH.value);
            expect(account.changes()).toEqual({
                statusChanged: false,
                credentialChanged: true
            });
            expect(account.pullEvents()[0].kind).toBe(
                IDENTITY_EVENT_KINDS.PASSWORD_CHANGED
            );
        });

        it('rejects changing the credential of a disabled account', () => {
            const account = rehydrated({ status: 'disabled' });
            expect(() => account.changeCredential(HASH)).toThrow(
                InvalidUserStateError
            );
        });
    });

    /**
     * The application drains the aggregate into the transactional outbox. A
     * second drain has to come back empty, or a single state change would be
     * published twice — and an outbox subscriber has no way to tell the
     * duplicate from a genuine repeat of the same transition.
     */
    describe('pullEvents', () => {
        it('returns the events in the order they were raised', () => {
            const account = rehydrated();
            account.disable();
            account.enable();

            expect(account.pullEvents().map((event) => event.kind)).toEqual([
                IDENTITY_EVENT_KINDS.USER_DISABLED,
                IDENTITY_EVENT_KINDS.USER_ENABLED
            ]);
        });

        it('drains what it returned, so a second pull is empty', () => {
            const account = rehydrated();
            account.disable();

            expect(account.pullEvents()).toHaveLength(1);
            expect(account.pullEvents()).toEqual([]);
        });

        it('is empty on an aggregate nothing was done to', () => {
            expect(rehydrated().pullEvents()).toEqual([]);
        });
    });

    /**
     * Rehydration is the boundary where a persisted row becomes a domain
     * object, and it is the last place a value the value objects reject can be
     * stopped. Letting one through would produce an aggregate whose guards
     * cannot reason about it and which would write the bad value straight back.
     */
    describe('rehydrate', () => {
        it('carries no pending changes or events', () => {
            const account = rehydrated();
            expect(account.changes()).toEqual({
                statusChanged: false,
                credentialChanged: false
            });
            expect(account.pullEvents()).toHaveLength(0);
        });

        it('keeps a pending account credential-less', () => {
            expect(pendingAccount().passwordHash).toBeNull();
        });

        it('rejects a status outside the lifecycle enum', () => {
            expect(() => rehydrated({ status: 'suspended' })).toThrow(
                InvalidUserStatusError
            );
        });

        it('rejects a malformed email', () => {
            expect(() =>
                UserAccount.rehydrate({
                    id: USER_ID,
                    email: 'ada@localhost',
                    status: 'active',
                    passwordHash: HASH.value
                })
            ).toThrow(InvalidEmailError);
        });

        it('rejects a non-UUID id', () => {
            expect(() =>
                UserAccount.rehydrate({
                    id: 'not-a-uuid',
                    email: 'ada@example.com',
                    status: 'active',
                    passwordHash: HASH.value
                })
            ).toThrow(InvalidUserIdError);
        });
    });
});
