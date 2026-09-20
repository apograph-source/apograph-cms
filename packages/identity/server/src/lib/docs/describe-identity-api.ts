/**
 * The identity plugin's pass over the host's OpenAPI document.
 *
 * `@nestjs/swagger` reflects static TypeScript and emits a bare
 * `{ '200': { description: '' } }` for every one of identity's operations: the
 * handlers return `interface`s, which are erased before the scanner runs. This
 * pass writes the real response schemas onto the operations that already exist,
 * from the same route tables a reader can check against the controllers.
 *
 * Pure: it takes the document and mutates only the paths this plugin owns.
 *
 * Two rules, both load-bearing:
 *
 * - **Never invent a status code.** A schema is written onto whichever 2xx key
 *   the scanner already emitted (Nest's default is 201 for `@Post`, 200
 *   elsewhere, and a `@HttpCode` moves it) — so `POST /auth/login` stays the
 *   `201` it really answers, and a `204` is left alone.
 * - **Match routes precisely.** {@link tailAfter} anchors each family to the
 *   first segment after a single-segment global prefix, so `/api/auth/me` is
 *   described and a hypothetical `/api/v1/auth/me` is not. The content plugin's
 *   pass once matched both spellings of its own routes and published the admin's
 *   shapes on the public API; the same mistake here would put an admin session
 *   list on a route that answers something else.
 *
 * `/api/users/{id}/sessions` is identity's, not the users plugin's — the two
 * plugins share the `/api/users` prefix and each table names only its own tails,
 * which is what keeps them from describing each other's routes.
 */

import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import type { OpenApiSchema } from './identity-schemas';
import { IDENTITY_SCHEMAS, ref } from './identity-schemas';

/** An operation object, as far as this pass needs to see one. */
interface Operation {
    responses?: Record<string, { description?: string; content?: unknown }>;
}

/** One operation's success body. */
interface OperationSpec {
    /** The schema the 2xx response carries. */
    schema: OpenApiSchema;
    /** The response description. */
    description: string;
}

/** An operation answering one named component schema. */
function answers(name: string, description: string): OperationSpec {
    return { schema: ref(name), description };
}

/** An operation answering an array of one named component schema. */
function answersList(name: string, description: string): OperationSpec {
    return { schema: { type: 'array', items: ref(name) }, description };
}

/** The acknowledgement body every credential route shares. */
const ACK = answers(
    'AuthAck',
    'Accepted. The session is carried by the `Set-Cookie` header, not by this body.'
);

/**
 * Auth routes, keyed by what follows `/auth`.
 *
 * **Four operations are deliberately absent**, and their absence is the honest
 * description: `/sso/{provider}/start` and both spellings of
 * `/sso/{provider}/callback` answer `302` with a `Location` and no body at all.
 * The scanner emitted a `200`/`201` for them because the handlers are typed
 * `Promise<void>` and write to the response themselves. Writing a JSON schema
 * onto that key would document a body that never arrives, and the rule against
 * inventing a status code equally forbids inventing a payload.
 */
const AUTH_ROUTES: Record<string, Record<string, OperationSpec>> = {
    '/me': {
        get: answers(
            'AuthenticatedUser',
            'The signed-in user and their role’s permissions.'
        )
    },
    '/login': { post: ACK },
    '/logout': {
        post: answers(
            'AuthAck',
            'Signed out. The session cookie is cleared by the response; the body says nothing else. Answers the same way when there was no session.'
        )
    },
    '/invite/{token}': {
        get: answers('InviteDescription', 'The invite the token stands for.')
    },
    '/invite/accept': { post: ACK },
    '/reset/{token}': {
        get: answers(
            'PasswordResetDescription',
            'The account the reset link belongs to.'
        )
    },
    '/reset': {
        post: answers(
            'AuthAck',
            'The password is set and every live session on the account is revoked. Unlike accepting an invite, this sets **no** session cookie: the caller finishes at the sign-in form.'
        )
    },
    '/sso': {
        get: answersList(
            'SsoProvider',
            'The registered providers, in the order the sign-in page shows them. `[]` when the deployment registered none.'
        )
    },
    '/sso/{provider}/backchannel-logout': {
        post: answers(
            'SsoBackchannelLogoutResult',
            'The notification was processed. `200` whether or not anything was revoked, per the OIDC back-channel logout spec.'
        )
    }
};

/**
 * The session routes identity mounts under `/users`, keyed by what follows it.
 *
 * The revoke is a `204` and so has no entry: it is not undescribed, it has no
 * body.
 */
const USER_SESSION_ROUTES: Record<string, Record<string, OperationSpec>> = {
    '/{id}/sessions': {
        get: answersList(
            'UserSession',
            'The member’s live sessions, most-recently-used first.'
        )
    }
};

/** API-token routes, keyed by what follows `/api-tokens`. */
const API_TOKEN_ROUTES: Record<string, Record<string, OperationSpec>> = {
    '': {
        get: answers('ApiTokenPage', 'One page of token metadata.'),
        post: answers(
            'MintedApiToken',
            'The minted token, including the plaintext `secret` — returned here and never again.'
        )
    }
};

/** One route family: the segment it hangs off, and the table for its tails. */
interface Family {
    /** The first path segment after the global prefix. */
    segment: string;
    /** Operations keyed by the tail after that segment, then by method. */
    routes: Record<string, Record<string, OperationSpec>>;
}

const FAMILIES: Family[] = [
    { segment: 'auth', routes: AUTH_ROUTES },
    { segment: 'users', routes: USER_SESSION_ROUTES },
    { segment: 'api-tokens', routes: API_TOKEN_ROUTES }
];

/**
 * The part of `route` that follows `/<prefix>/<segment>`, or `undefined` when
 * this route is not that family's.
 *
 * The prefix is allowed to be one segment (`/api/auth/me`, the deployed
 * spelling) or none (`/auth/me`, a host that set `globalPrefix: ''`) — and
 * nothing else. That is what makes `/api/v1/auth/me` a non-match rather than a
 * silent alias, which is the failure worth preventing: a wrong schema on a route
 * is worse than no schema, because a consumer codes against it. A host running a
 * multi-segment prefix gets no identity schemas rather than misplaced ones.
 */
export function tailAfter(route: string, segment: string): string | undefined {
    const pattern = new RegExp(
        `^(?:/[^/]+)?/${escapeForRegExp(segment)}(/.*)?$`
    );
    const match = pattern.exec(route);
    return match ? (match[1] ?? '') : undefined;
}

/** Escapes the regex metacharacters a path segment may legally contain. */
function escapeForRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Writes a success response's schema onto whichever 2xx key the scanner already
 * emitted, so this never invents a status code the API does not return. A `204`
 * is left untouched: it has no body by definition.
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

/**
 * Adds identity's schemas to `document` and attaches them to identity's own
 * operations.
 */
export function describeIdentityApi(document: OpenApiDocument): void {
    document.components ??= {};
    document.components.schemas ??= {};
    Object.assign(document.components.schemas, IDENTITY_SCHEMAS);

    for (const [route, item] of Object.entries(document.paths)) {
        for (const family of FAMILIES) {
            const tail = tailAfter(route, family.segment);
            if (tail === undefined) {
                continue;
            }
            const byMethod = family.routes[tail];
            if (!byMethod) {
                break;
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
            break;
        }
    }
}
