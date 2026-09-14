/**
 * The complete v1 permission catalogue, keyed by a symbolic name so call sites
 * reference `PERMISSIONS.WORKSPACES_CREATE` instead of repeating the string
 * literal. Seeded into the `permissions` table; the guard
 * (`@RequirePermissions(...)`), the role matrix below, and the seed tests all
 * read from here, so the permission set has exactly one source of truth.
 */
export const PERMISSIONS = {
    WORKSPACES_CREATE: 'workspaces:create',
    WORKSPACES_READ: 'workspaces:read',
    WORKSPACES_UPDATE: 'workspaces:update',
    WORKSPACES_DELETE: 'workspaces:delete',
    USERS_READ: 'users:read',
    USERS_CREATE: 'users:create',
    USERS_UPDATE: 'users:update',
    USERS_DELETE: 'users:delete',
    /**
     * Authority over a member's credentials themselves, as opposed to their
     * record: today, revealing the link of an invitation or reset that never
     * arrived (ADR-0018 §4). Separate from `users:update` because that key is
     * about editing somebody's name and role, and this one hands over a secret
     * that takes over their account.
     */
    USERS_MANAGE: 'users:manage',
    ACTIVITY_READ: 'activity:read',
    CONTENT_READ: 'content:read',
    CONTENT_CREATE: 'content:create',
    CONTENT_UPDATE: 'content:update',
    CONTENT_PUBLISH: 'content:publish',
    CONTENT_APPROVE: 'content:approve',
    CONTENT_DELETE: 'content:delete',
    CONTENT_EXPORT: 'content:export',
    CONTENT_IMPORT: 'content:import',
    MEDIA_READ: 'media:read',
    MEDIA_CREATE: 'media:create',
    MEDIA_UPDATE: 'media:update',
    MEDIA_DELETE: 'media:delete',
    TOKENS_READ: 'tokens:read',
    TOKENS_CREATE: 'tokens:create',
    TOKENS_DELETE: 'tokens:delete',
    COPILOT_USE: 'copilot:use',
    COPILOT_SKILLS_MANAGE: 'copilot:skills:manage',
    ALARMS_READ: 'alarms:read',
    ALARMS_MANAGE: 'alarms:manage',
    VIEWS_SHARE: 'views:share',
    SEGMENTS_READ: 'segments:read',
    SEGMENTS_MANAGE: 'segments:manage',
    WEBHOOKS_READ: 'webhooks:read',
    WEBHOOKS_MANAGE: 'webhooks:manage',
    PROTECTION_MANAGE: 'protection:manage'
} as const;

/**
 * A `resource:action` permission key drawn from {@link PERMISSIONS} — with an
 * optional sub-resource segment (`copilot:skills:manage`). Every key must pass
 * `Permission.create`'s shape check, or the guard 500s on the route requiring
 * it.
 */
export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Every permission key — the catalogue seeded into the `permissions` table. */
export const PERMISSION_KEYS = Object.values(PERMISSIONS) as PermissionKey[];

/** A built-in role and the permission keys it is granted. */
export interface SystemRole {
    /** Stable machine key written to `roles.key`. */
    key: string;
    /** Human-readable label written to `roles.name`. */
    name: string;
    /** Granted permission keys; each must exist in {@link PERMISSIONS}. */
    permissions: readonly PermissionKey[];
}

/**
 * The three built-in roles and their grants — the §4.2 matrix verbatim.
 * Admin holds the full enumerated set (no wildcard, by decision): a future
 * permission must be added both to {@link PERMISSIONS} and to admin's grants
 * here.
 *
 * `copilot:use` is granted to **every** role, viewer included
 * ([ADR-0005](../../../../../../docs/adr/0005-copilot-authority-model.md) §10):
 * the copilot has no authority of its own, so a viewer's copilot is
 * *provably* read-only — it can only ever offer the tools that viewer's own
 * permissions already allow. Cost is handled with per-role rate limits rather
 * than by excluding the largest population from the feature.
 *
 * There is **no** `copilot:configure`:
 * [ADR-0009](../../../../../../docs/adr/0009-copilot-applies-directly.md)
 * deleted the per-workspace policy it gated, and the key with it. It is worth
 * naming here because the key outlived its deletion in every existing database
 * — `seedSystemRoles` used to be additive-only, so the `permissions` row and
 * its grant to `admin` persisted and `/auth/me` kept returning 24 keys against
 * the 23 defined above. The seeder now reconciles in both directions, so
 * removing a key from this file removes the grant.
 *
 * `content:export` and `content:import` are separate keys rather than folded
 * into read and create, because they are separate capabilities. Reading the
 * library a page at a time and taking it out of the system in one file — media
 * bytes included — are not the same act, and the second is the one an operator
 * wants to be able to withhold and to audit. So **viewer does not get export**
 * even though a viewer can already read every record: the difference is bulk
 * egress, not access. Import is granted alongside it for contributors, but the
 * use-case additionally requires the ordinary `content:create` /
 * `content:update` for each write it performs, so importing can never do more
 * than the caller could have done by hand.
 *
 * `content:delete` and `media:delete` are granted to contributor: removing the
 * draft that should never have existed, or the wrong upload, is the same
 * editorial act as writing it, and a role that can publish to the world but
 * cannot retract is the more dangerous of the two. Both are audited
 * (`content.entry.deleted` / `media.asset.deleted`), and a paranoid content
 * type deletes to a tombstone that restore undoes — but a non-paranoid entry
 * and an asset's bytes are gone, so this is a real grant, not a reversible one.
 * An operator who wants deletion held back mints a custom role without the two
 * keys; the routes gate on the permission, never on the role.
 *
 * `views:share` gates only **sharing** a saved list view with the workspace,
 * not saving one. Every role can save private views — that is a personal
 * bookmark over content they can already read — but a shared view becomes a
 * navigation item for the whole workspace, which is an editorial decision.
 * Contributors hold it; viewers do not, and are not blocked from anything by
 * its absence.
 *
 * The two `segments:*` keys gate **reader entitlements** — who may read a
 * published entry. `segments:read` is granted to contributor and viewer: an
 * editor who cannot see that an entry is restricted will publish one believing
 * it is public, and the state is already shown in the entry editor.
 * `segments:manage` is **admin-only**: renaming a segment's tags changes who
 * every entry naming it is visible to, which is a configuration decision rather
 * than an editorial one.
 *
 * The two `webhooks:*` keys are **both admin-only**, which is stricter than the
 * read/manage splits above and deliberately so. A webhook endpoint is not
 * scoped to a workspace, it reaches across every workspace it names, and its
 * delivery log records where this installation talks to on the network. That is
 * infrastructure configuration in the same family as an API token, not an
 * editorial surface — so even reading it is withheld from contributors, unlike
 * `alarms:read` or `segments:read`, which describe content an editor is already
 * working on.
 *
 * `content:approve` is granted to **contributor** and to admin, and withheld
 * from **viewer**. Approving is an editorial act — it is the statement that a
 * second person read the thing — so the role that reads without editing does
 * not get to make it. Granting it to contributor is also what keeps every
 * existing installation behaving exactly as it does: the role that could
 * already publish can now also approve, and until somebody writes a rule
 * neither key does anything new.
 *
 * **No API token scope grants it** (`protection:I-12`, pinned in
 * `api-token-scope.spec.ts`). A token names no person, and ADR-0017 §6's
 * refusal to offer an approve tool on any surface buys nothing if minting a key
 * casts the vote the tool may not.
 *
 * `protection:manage` is **admin-only**, and has no `protection:read` beside
 * it — the only asymmetry in this catalogue, and deliberate. A publication
 * protection rule is configuration of the same class as `alarms:manage`:
 * turning one on decides who may ship a content type, for everybody. The
 * missing read half is the interesting part. A contributor does need to know
 * that *this entry* wants two approvals, but that answer comes from the entry
 * itself under `content:read`, not from the workspace's rule table — so nobody
 * but an administrator has a reason to read the table, and a key nobody needs
 * is a key that only ever gets granted by accident.
 *
 * `copilot:skills:manage` is **admin-only** for the same class of reason
 * ([ADR-0010](../../../../../../docs/adr/0010-copilot-skills.md)): a skill's
 * instructions are prompt text that runs for every member of the workspace, so
 * authoring one is a configuration decision rather than a content one. Using a
 * skill needs nothing beyond `copilot:use`, which every role holds.
 */
export const SYSTEM_ROLES: readonly SystemRole[] = [
    { key: 'admin', name: 'Administrator', permissions: [...PERMISSION_KEYS] },
    {
        key: 'contributor',
        name: 'Contributor',
        permissions: [
            PERMISSIONS.WORKSPACES_READ,
            PERMISSIONS.USERS_READ,
            PERMISSIONS.CONTENT_READ,
            PERMISSIONS.CONTENT_CREATE,
            PERMISSIONS.CONTENT_UPDATE,
            PERMISSIONS.CONTENT_PUBLISH,
            // Approving is an editorial act, so it lands on the role that
            // edits — and it lands there rather than on a new "reviewer" role
            // because a rule blocks everyone equally: an installation that
            // wants a reviewer who cannot write mints a custom role with this
            // key and without `content:update`, which is operator
            // configuration and not this feature's business.
            PERMISSIONS.CONTENT_APPROVE,
            PERMISSIONS.CONTENT_DELETE,
            PERMISSIONS.CONTENT_EXPORT,
            PERMISSIONS.CONTENT_IMPORT,
            PERMISSIONS.MEDIA_READ,
            PERMISSIONS.MEDIA_CREATE,
            PERMISSIONS.MEDIA_UPDATE,
            PERMISSIONS.MEDIA_DELETE,
            // Findings are shown inline in the entry editor, so the role
            // that edits entries has to be able to read them. Writing the
            // rules is `alarms:manage` and stays with admin: a rule is
            // editorial policy, not an edit.
            PERMISSIONS.ALARMS_READ,
            PERMISSIONS.COPILOT_USE,
            PERMISSIONS.VIEWS_SHARE,
            PERMISSIONS.SEGMENTS_READ
        ]
    },
    {
        key: 'viewer',
        name: 'Viewer',
        permissions: [
            PERMISSIONS.WORKSPACES_READ,
            PERMISSIONS.USERS_READ,
            PERMISSIONS.CONTENT_READ,
            PERMISSIONS.MEDIA_READ,
            PERMISSIONS.ALARMS_READ,
            PERMISSIONS.COPILOT_USE,
            PERMISSIONS.SEGMENTS_READ
        ]
    }
] as const;
