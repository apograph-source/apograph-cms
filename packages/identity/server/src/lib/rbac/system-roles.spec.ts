import { Permission } from '../domain/value-objects/permission';
import {
    PERMISSIONS,
    PERMISSION_KEYS,
    SYSTEM_ROLES,
    type SystemRole
} from './system-roles';

/** The built-in role with `key`, or a failure naming the missing one. */
function systemRole(key: string): SystemRole {
    const role = SYSTEM_ROLES.find((candidate) => candidate.key === key);
    if (!role) {
        throw new Error(`no system role seeded under the key "${key}"`);
    }
    return role;
}

/** The role's grants, sorted, so a set comparison is order-independent. */
function grants(key: string): string[] {
    return [...systemRole(key).permissions].sort();
}

describe('SYSTEM_ROLES', () => {
    /**
     * identity:I-14: admin holds the full set **by enumeration**, and the system has no
     * wildcard permission at all. Both halves matter — a `*` grant would make
     * every future permission silently admin's, which is the failure mode the
     * enumeration exists to prevent. A new key added to the catalogue without
     * being granted to admin fails here, which is the intended nag.
     */
    describe('admin', () => {
        it('grants exactly the catalogue, by enumeration [identity:I-14]', () => {
            expect(grants('admin')).toEqual([...PERMISSION_KEYS].sort());
        });

        it('grants every key exactly once', () => {
            const permissions = systemRole('admin').permissions;
            expect(new Set(permissions).size).toBe(permissions.length);
        });
    });

    describe('the permission catalogue', () => {
        it('enumerates 36 distinct keys', () => {
            expect(PERMISSION_KEYS).toHaveLength(36);
            expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
        });

        it('contains no wildcard, in any role [identity:I-14]', () => {
            for (const role of SYSTEM_ROLES) {
                for (const permission of role.permissions) {
                    expect(permission).not.toContain('*');
                    expect(() => Permission.create(permission)).not.toThrow();
                }
            }
        });
    });

    /**
     * The §4.2 matrix, asserted as whole sets rather than spot checks: a grant
     * quietly added to contributor or viewer is a widening of authority, and
     * only an exact comparison catches one.
     */
    describe('contributor', () => {
        it('grants the matrix set', () => {
            expect(grants('contributor')).toEqual(
                [
                    PERMISSIONS.WORKSPACES_READ,
                    PERMISSIONS.USERS_READ,
                    PERMISSIONS.CONTENT_READ,
                    PERMISSIONS.CONTENT_CREATE,
                    PERMISSIONS.CONTENT_UPDATE,
                    PERMISSIONS.CONTENT_PUBLISH,
                    PERMISSIONS.CONTENT_APPROVE,
                    PERMISSIONS.CONTENT_DELETE,
                    PERMISSIONS.CONTENT_EXPORT,
                    PERMISSIONS.CONTENT_IMPORT,
                    PERMISSIONS.MEDIA_READ,
                    PERMISSIONS.MEDIA_CREATE,
                    PERMISSIONS.MEDIA_UPDATE,
                    PERMISSIONS.MEDIA_DELETE,
                    PERMISSIONS.ALARMS_READ,
                    PERMISSIONS.COPILOT_USE,
                    PERMISSIONS.VIEWS_SHARE,
                    PERMISSIONS.SEGMENTS_READ
                ].sort()
            );
        });

        it.each([
            PERMISSIONS.ALARMS_MANAGE,
            PERMISSIONS.SEGMENTS_MANAGE,
            PERMISSIONS.COPILOT_SKILLS_MANAGE,
            PERMISSIONS.USERS_CREATE,
            PERMISSIONS.TOKENS_CREATE,
            PERMISSIONS.WEBHOOKS_READ,
            PERMISSIONS.WEBHOOKS_MANAGE,
            // Writing a protection rule decides who may ship a content type
            // for everybody — configuration, not editing.
            PERMISSIONS.PROTECTION_MANAGE
        ])('does not grant the configuration permission %p', (permission) => {
            expect(grants('contributor')).not.toContain(permission);
        });
    });

    describe('viewer', () => {
        it('grants the matrix set', () => {
            expect(grants('viewer')).toEqual(
                [
                    PERMISSIONS.WORKSPACES_READ,
                    PERMISSIONS.USERS_READ,
                    PERMISSIONS.CONTENT_READ,
                    PERMISSIONS.MEDIA_READ,
                    PERMISSIONS.ALARMS_READ,
                    PERMISSIONS.COPILOT_USE,
                    PERMISSIONS.SEGMENTS_READ
                ].sort()
            );
        });

        // Bulk egress is not the same capability as reading the library a page
        // at a time; sharing a view and renaming an audience are editorial and
        // configuration decisions a viewer does not make. Approving is the
        // most editorial act of the lot — it is the statement that a second
        // person read the thing, and it unlocks a publication.
        it.each([
            PERMISSIONS.CONTENT_EXPORT,
            PERMISSIONS.VIEWS_SHARE,
            PERMISSIONS.SEGMENTS_MANAGE,
            PERMISSIONS.CONTENT_APPROVE
        ])('does not grant %p', (permission) => {
            expect(grants('viewer')).not.toContain(permission);
        });
    });

    /**
     * ADR-0005 §10: the copilot carries no authority of its own, so every role
     * — viewer included — may use it. ADR-0009 deleted the per-workspace policy
     * that `copilot:configure` gated, and the key with it; the seeder now
     * reconciles in both directions, so the key must be absent from the
     * catalogue rather than merely ungranted.
     */
    describe('copilot', () => {
        it.each(['admin', 'contributor', 'viewer'])(
            'grants copilot:use to %s',
            (key) => {
                expect(grants(key)).toContain(PERMISSIONS.COPILOT_USE);
            }
        );

        it('defines no copilot:configure key', () => {
            expect(PERMISSION_KEYS).not.toContain('copilot:configure');
        });
    });
});
