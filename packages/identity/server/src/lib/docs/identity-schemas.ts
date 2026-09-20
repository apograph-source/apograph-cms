/**
 * The response shapes identity's routes answer with, as plain OpenAPI schema
 * objects.
 *
 * Written by hand rather than derived from a class, because every one of these
 * views is a TypeScript `interface` — erased at compile time, invisible to the
 * `@nestjs/swagger` scanner, and in two cases (`SsoProviderSummary`) declared in
 * `identity/domain`, where ADR-0003 forbids the decorator import a described
 * class would need. See `packages/bootstrap/server/AGENTS.md` →
 * "The response-schema gap".
 *
 * Every schema here was checked against a live response, not transcribed from
 * its type. Where the two disagreed, the live response won and the difference is
 * noted on the schema.
 */

import { API_TOKEN_SCOPES } from '../api-tokens/domain/api-token-scope';
import { PERMISSION_KEYS } from '../rbac/system-roles';

/** A JSON Schema fragment, as it appears in the OpenAPI document. */
export type OpenApiSchema = Record<string, unknown>;

/** `#/components/schemas/<name>`. */
export function ref(name: string): OpenApiSchema {
    return { $ref: `#/components/schemas/${name}` };
}

const UUID: OpenApiSchema = { type: 'string', format: 'uuid' };
const DATE_TIME: OpenApiSchema = { type: 'string', format: 'date-time' };

/** A `Date | null` field: ISO-8601 on the wire, or JSON `null`. */
const NULLABLE_DATE_TIME: OpenApiSchema = {
    type: 'string',
    format: 'date-time',
    nullable: true
};

/**
 * A `string | null` field.
 *
 * `nullable: true` sits **beside** `type`, never beside a bare `oneOf`/`$ref`
 * — on those it is inert in OpenAPI 3.0 and silently widens nothing.
 */
function nullableString(description: string): OpenApiSchema {
    return { type: 'string', nullable: true, description };
}

/** The account lifecycle states, mirroring identity's `user_status` enum. */
export const USER_STATUSES = ['pending', 'active', 'disabled'] as const;

/**
 * The current user as `GET /api/auth/me` answers it — identity's `PublicUser`
 * plus the permission keys the user's role grants.
 *
 * Note what is **not** here: the session token. A session is an `httpOnly`
 * cookie set by `POST /api/auth/login`, whose own body is only
 * {@link AUTH_ACK_SCHEMA}. The two are different shapes on purpose, and a
 * consumer that expects the login call to hand back a user object will find an
 * acknowledgement instead.
 */
const AUTHENTICATED_USER_SCHEMA: OpenApiSchema = {
    type: 'object',
    description:
        'The signed-in user and the permissions their single global role grants.',
    required: ['id', 'email', 'name', 'roleId', 'status', 'permissions'],
    properties: {
        id: UUID,
        email: { type: 'string', format: 'email' },
        name: nullableString(
            'Display name; null until the user sets one on invite accept.'
        ),
        roleId: UUID,
        status: { type: 'string', enum: [...USER_STATUSES] },
        permissions: {
            type: 'array',
            description:
                'Every permission key the role grants, unordered. The admin UI gates on these.',
            items: { type: 'string', enum: [...PERMISSION_KEYS] }
        }
    }
};

/**
 * The body every credential route answers with: a bare acknowledgement.
 *
 * `login`, `logout`, `invite/accept` and `reset` all return exactly
 * `{"ok": true}` — verified against the live server. What actually changes is
 * the `Set-Cookie` header, which is why the body carries nothing: the session is
 * the cookie, and none of these routes ever puts a token in JSON. `reset`
 * deliberately does not even report how many sessions it evicted.
 */
const AUTH_ACK_SCHEMA: OpenApiSchema = {
    type: 'object',
    description:
        'Acknowledgement. The result of the call is in the `Set-Cookie` header (or, for logout and reset, in its absence) — never in this body.',
    required: ['ok'],
    properties: { ok: { type: 'boolean', enum: [true] } }
};

/** What an invite link stands for, so the accept screen can greet the invitee. */
const INVITE_DESCRIPTION_SCHEMA: OpenApiSchema = {
    type: 'object',
    description:
        'The invite behind a token. Every invalid token — unknown, expired, already accepted, revoked — is one generic 404 instead, so this cannot be used to probe for live invites.',
    required: ['email', 'name'],
    properties: {
        email: { type: 'string', format: 'email' },
        name: nullableString(
            'The display name the inviting admin set, or null when they set none.'
        )
    }
};

/** What a reset link stands for, so the screen can name the account. */
const PASSWORD_RESET_DESCRIPTION_SCHEMA: OpenApiSchema = {
    type: 'object',
    description:
        'The account a reset link resets. Every invalid token is one generic 404 instead.',
    required: ['email', 'name'],
    properties: {
        email: { type: 'string', format: 'email' },
        name: nullableString("The account's display name, or null.")
    }
};

/** One sign-in button, as the sign-in page renders it. */
const SSO_PROVIDER_SCHEMA: OpenApiSchema = {
    type: 'object',
    description:
        'One registered identity provider. Carries nothing about any particular person: the list answers before anyone has identified themselves.',
    required: ['name', 'label', 'kind'],
    properties: {
        name: {
            type: 'string',
            description: 'The registered name — what `/start` is called with.'
        },
        label: { type: 'string', description: 'The button label.' },
        kind: { type: 'string', enum: ['oidc', 'oauth2', 'saml'] }
    }
};

/** What a back-channel logout notification reports. */
const SSO_BACKCHANNEL_LOGOUT_SCHEMA: OpenApiSchema = {
    type: 'object',
    description:
        'How many Ortha sessions the notification ended. `0` is a normal answer: the endpoint is idempotent, because a provider retrying a notification is expected.',
    required: ['revoked'],
    properties: { revoked: { type: 'integer', minimum: 0 } }
};

/** One live session on a member's account, as the admin Sessions tab reads it. */
const USER_SESSION_SCHEMA: OpenApiSchema = {
    type: 'object',
    description:
        "One live session. Display metadata only — the session's own token is never returned.",
    required: [
        'id',
        'userAgent',
        'ipAddress',
        'createdAt',
        'lastUsedAt',
        'expiresAt',
        'current'
    ],
    properties: {
        id: {
            type: 'string',
            description:
                'Revocation handle: the session row id, which is the SHA-256 of the session token (64 lowercase hex characters) — not a UUID.',
            pattern: '^[0-9a-f]{64}$'
        },
        userAgent: nullableString('Originating `User-Agent`, if captured.'),
        ipAddress: nullableString('Originating IP, if captured.'),
        createdAt: DATE_TIME,
        lastUsedAt: DATE_TIME,
        expiresAt: DATE_TIME,
        current: {
            type: 'boolean',
            description:
                "Whether this row is the caller's own presented session. Only ever true when an admin inspects their own sessions."
        }
    }
};

/** An API token's metadata — everything but the secret. */
const API_TOKEN_SCHEMA: OpenApiSchema = {
    type: 'object',
    description:
        'An external-API bearer token, without its secret. This is the only shape the list route ever returns.',
    required: [
        'id',
        'name',
        'workspaceIds',
        'scope',
        'lookupPrefix',
        'expiresAt',
        'lastUsedAt',
        'revokedAt',
        'createdAt'
    ],
    properties: {
        id: UUID,
        name: { type: 'string' },
        workspaceIds: {
            type: 'array',
            description:
                'Every workspace the token may act in — always at least one.',
            items: UUID,
            minItems: 1
        },
        scope: { type: 'string', enum: [...API_TOKEN_SCOPES] },
        lookupPrefix: {
            type: 'string',
            description:
                "The token's non-secret leading characters (e.g. `ortha_0TYI4Q`), so a person can tell two tokens apart in a list."
        },
        expiresAt: NULLABLE_DATE_TIME,
        lastUsedAt: NULLABLE_DATE_TIME,
        revokedAt: NULLABLE_DATE_TIME,
        createdAt: DATE_TIME
    }
};

/**
 * The mint response: the metadata **plus** the plaintext secret.
 *
 * A separate schema from {@link API_TOKEN_SCHEMA} rather than the same one with
 * an optional field, because `secret` is not sometimes-present — it exists in
 * exactly one response in the whole API and can never be read again. Describing
 * it as optional on the shared shape would suggest the list might carry it.
 */
const MINTED_API_TOKEN_SCHEMA: OpenApiSchema = {
    allOf: [
        ref('ApiToken'),
        {
            type: 'object',
            required: ['secret'],
            properties: {
                secret: {
                    type: 'string',
                    description:
                        'The raw bearer token. Returned by this call and never again — only its SHA-256 is stored.'
                }
            }
        }
    ],
    description:
        'A freshly minted token. The only response in the API that carries a token secret.'
};

/** One page of token metadata. */
const API_TOKEN_PAGE_SCHEMA: OpenApiSchema = {
    type: 'object',
    required: ['items', 'total', 'page', 'pageSize'],
    properties: {
        items: { type: 'array', items: ref('ApiToken') },
        total: {
            type: 'integer',
            minimum: 0,
            description: 'Total tokens matching the filter, across all pages.'
        },
        page: {
            type: 'integer',
            minimum: 1,
            description: '1-based page number, echoed back.'
        },
        pageSize: { type: 'integer', minimum: 1 }
    }
};

/** Every schema this plugin contributes, keyed by component name. */
export const IDENTITY_SCHEMAS: Record<string, OpenApiSchema> = {
    AuthenticatedUser: AUTHENTICATED_USER_SCHEMA,
    AuthAck: AUTH_ACK_SCHEMA,
    InviteDescription: INVITE_DESCRIPTION_SCHEMA,
    PasswordResetDescription: PASSWORD_RESET_DESCRIPTION_SCHEMA,
    SsoProvider: SSO_PROVIDER_SCHEMA,
    SsoBackchannelLogoutResult: SSO_BACKCHANNEL_LOGOUT_SCHEMA,
    UserSession: USER_SESSION_SCHEMA,
    ApiToken: API_TOKEN_SCHEMA,
    MintedApiToken: MINTED_API_TOKEN_SCHEMA,
    ApiTokenPage: API_TOKEN_PAGE_SCHEMA
};
