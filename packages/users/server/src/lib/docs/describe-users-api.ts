/**
 * The users plugin's pass over the host's OpenAPI document.
 *
 * Every member route returns a `MemberView` (or one of its two token-carrying
 * extensions), and every one of those is a TypeScript `interface` — erased
 * before `@nestjs/swagger` reflects the controllers, which is why the scanner
 * emits a status code and no payload. This pass writes the shapes back on,
 * without a decorator and without turning the views into classes. See
 * `packages/bootstrap/server/AGENTS.md` → "The response-schema gap".
 *
 * Pure: it takes the document and mutates only the paths this plugin owns.
 *
 * The `/api/users` prefix is **shared with identity**, which mounts
 * `/{id}/sessions` there. Each plugin's table names only its own tails, so
 * neither describes the other's routes — and a tail this table does not name is
 * left exactly as the scanner emitted it.
 */

import type { OpenApiDocument } from '@ortha/bootstrap-server';
import { ASSIGNABLE_ROLE_KEYS } from '../member/domain/value-objects/role';

/** A JSON Schema fragment, as it appears in the OpenAPI document. */
type OpenApiSchema = Record<string, unknown>;

/** An operation object, as far as this pass needs to see one. */
interface Operation {
    responses?: Record<string, { description?: string; content?: unknown }>;
}

/** One operation's success body. */
interface OperationSpec {
    schema: OpenApiSchema;
    description: string;
}

/** `#/components/schemas/<name>`. */
function ref(name: string): OpenApiSchema {
    return { $ref: `#/components/schemas/${name}` };
}

const UUID: OpenApiSchema = { type: 'string', format: 'uuid' };

/** The role a member holds, joined from `users → roles`. */
const MEMBER_ROLE_SCHEMA: OpenApiSchema = {
    type: 'object',
    required: ['id', 'key', 'name'],
    properties: {
        id: UUID,
        key: {
            type: 'string',
            description:
                'Stable machine key. The three seeded system roles are the only ones a member can hold.',
            enum: [...ASSIGNABLE_ROLE_KEYS]
        },
        name: {
            type: 'string',
            description: 'Human-readable label, e.g. `Administrator`.'
        }
    }
};

/** A workspace a member belongs to, joined from `memberships → workspaces`. */
const MEMBER_WORKSPACE_SCHEMA: OpenApiSchema = {
    type: 'object',
    required: ['id', 'name', 'description', 'color'],
    properties: {
        id: UUID,
        name: { type: 'string' },
        description: {
            type: 'string',
            nullable: true,
            description: 'Short description, or null when none is set.'
        },
        color: {
            type: 'string',
            description:
                'Accent colour key (a design-system `AVATAR_COLORS` value).'
        }
    }
};

/**
 * A member of the system.
 *
 * `status` mirrors identity's `user_status` enum, and `pending` is an invite
 * that has not been accepted — for those rows `createdAt` is the invite date
 * rather than a join date.
 */
const MEMBER_SCHEMA: OpenApiSchema = {
    type: 'object',
    required: [
        'id',
        'email',
        'name',
        'role',
        'status',
        'createdAt',
        'isLastAdmin',
        'workspaces'
    ],
    properties: {
        id: UUID,
        email: { type: 'string', format: 'email' },
        name: {
            type: 'string',
            nullable: true,
            description:
                'Display name, or null until the user sets one on invite accept.'
        },
        role: ref('MemberRole'),
        status: {
            type: 'string',
            enum: ['pending', 'active', 'disabled'],
            description:
                '`pending` is an invite that has not been accepted yet; the admin renders it as "Invited".'
        },
        createdAt: {
            type: 'string',
            format: 'date-time',
            description:
                'Membership creation date; the invite date while `pending`.'
        },
        isLastAdmin: {
            type: 'boolean',
            description:
                'Whether this member is the only active administrator. Computed server-side so the UI can disable demote/disable with an explanation; the use cases enforce it regardless.'
        },
        workspaces: {
            type: 'array',
            items: ref('MemberWorkspace'),
            description: 'The workspaces this member belongs to, name-ordered.'
        }
    }
};

/**
 * A member plus the one-time invite token just issued for them.
 *
 * A distinct schema rather than `Member` with an optional `inviteToken`: the
 * token exists in readable form in exactly two responses (invite and resend) and
 * nowhere else, because only its hash is stored. Describing it as optional on
 * the shared shape would suggest the list or detail read might carry one.
 */
const INVITED_MEMBER_SCHEMA: OpenApiSchema = {
    allOf: [
        ref('Member'),
        {
            type: 'object',
            required: ['inviteToken'],
            properties: {
                inviteToken: {
                    type: 'string',
                    description:
                        'The raw invite token — the secret half of the invite link, shown to the inviting admin exactly once.'
                }
            }
        }
    ]
};

/** A member plus the one-time password-reset token just issued for them. */
const PASSWORD_RESET_MEMBER_SCHEMA: OpenApiSchema = {
    allOf: [
        ref('Member'),
        {
            type: 'object',
            required: ['resetToken'],
            properties: {
                resetToken: {
                    type: 'string',
                    description:
                        'The raw reset token, shown to the issuing admin exactly once. Issuing rotates it, so any outstanding link is already dead.'
                }
            }
        }
    ]
};

/** One page of members. */
const MEMBER_PAGE_SCHEMA: OpenApiSchema = {
    type: 'object',
    required: ['items', 'total', 'page', 'pageSize'],
    properties: {
        items: { type: 'array', items: ref('Member') },
        total: {
            type: 'integer',
            minimum: 0,
            description: 'Total members matching the search, across all pages.'
        },
        page: {
            type: 'integer',
            minimum: 1,
            description: '1-based, echoed back.'
        },
        pageSize: { type: 'integer', minimum: 1 }
    }
};

/** Every schema this plugin contributes, keyed by component name. */
const USERS_SCHEMAS: Record<string, OpenApiSchema> = {
    Member: MEMBER_SCHEMA,
    MemberRole: MEMBER_ROLE_SCHEMA,
    MemberWorkspace: MEMBER_WORKSPACE_SCHEMA,
    MemberPage: MEMBER_PAGE_SCHEMA,
    InvitedMember: INVITED_MEMBER_SCHEMA,
    PasswordResetMember: PASSWORD_RESET_MEMBER_SCHEMA
};

/** An operation answering one named component schema. */
function answers(name: string, description: string): OperationSpec {
    return { schema: ref(name), description };
}

/** The member view every mutation echoes back. */
const MEMBER = answers('Member', 'The member, as it now stands.');

/**
 * Member routes, keyed by what follows `/users`.
 *
 * `/{id}/invites` (DELETE) is absent because it answers `204` — it has no body
 * rather than an undescribed one. `/{id}/sessions` and
 * `/{id}/sessions/{sessionId}` are absent because they belong to
 * `@ortha/identity-server`, which describes them itself.
 */
const MEMBER_ROUTES: Record<string, Record<string, OperationSpec>> = {
    '': { get: answers('MemberPage', 'One page of members.') },
    '/invites': {
        post: answers(
            'InvitedMember',
            'The new pending member, plus the raw `inviteToken` — the admin’s only chance to capture the link, since no mailer sends it yet.'
        )
    },
    '/{id}': { get: MEMBER, patch: MEMBER },
    '/{id}/disable': { post: MEMBER },
    '/{id}/enable': { post: MEMBER },
    '/{id}/invites/resend': {
        post: answers(
            'InvitedMember',
            'The member, plus a freshly issued `inviteToken`. Resending rotates the token, so the previous link stops working.'
        )
    },
    '/{id}/password-reset': {
        post: answers(
            'PasswordResetMember',
            'The member, plus the raw `resetToken` for the link the admin hands over.'
        )
    }
};

/**
 * The part of `route` that follows `/<prefix>/users`, or `undefined` when the
 * route is not a member route.
 *
 * The prefix may be one segment (`/api/users`, the deployed spelling) or none —
 * and nothing else, so a hypothetical `/api/v1/users/{id}` is a non-match rather
 * than a silent alias carrying the admin surface's shapes. A wrong schema is
 * worse than no schema; a host with a multi-segment prefix gets none.
 */
export function memberRouteTail(route: string): string | undefined {
    const match = /^(?:\/[^/]+)?\/users(\/.*)?$/.exec(route);
    return match ? (match[1] ?? '') : undefined;
}

/**
 * Writes a success response's schema onto whichever 2xx key the scanner already
 * emitted, so this never invents a status code the API does not return
 * (`POST /api/users/{id}/enable` really does answer `201`). A `204` is left
 * untouched.
 */
function setSuccessResponse(
    operation: Operation,
    schema: OpenApiSchema,
    description: string
): void {
    const responses = operation.responses ?? {};
    const key = Object.keys(responses).find((code) => /^2\d\d$/.test(code));
    if (!key || key === '204') {
        return;
    }
    responses[key] = {
        description,
        content: { 'application/json': { schema } }
    };
    operation.responses = responses;
}

/** Adds the member schemas to `document` and attaches them to its own routes. */
export function describeUsersApi(document: OpenApiDocument): void {
    document.components ??= {};
    document.components.schemas ??= {};
    Object.assign(document.components.schemas, USERS_SCHEMAS);

    for (const [route, item] of Object.entries(document.paths)) {
        const tail = memberRouteTail(route);
        if (tail === undefined) {
            continue;
        }
        const byMethod = MEMBER_ROUTES[tail];
        if (!byMethod) {
            continue;
        }
        for (const [method, operation] of Object.entries(
            item as Record<string, Operation>
        )) {
            const spec = byMethod[method];
            if (!spec || !operation || typeof operation !== 'object') {
                continue;
            }
            setSuccessResponse(operation, spec.schema, spec.description);
        }
    }
}
