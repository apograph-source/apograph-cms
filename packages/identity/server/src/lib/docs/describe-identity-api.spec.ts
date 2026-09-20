import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import { describeIdentityApi, tailAfter } from './describe-identity-api';

/** An operation as the scanner leaves it: a status code and nothing else. */
function scanned(code: string): Record<string, unknown> {
    return { responses: { [code]: { description: '' } } };
}

/** The shape `@nestjs/swagger` produces for identity before this pass runs. */
function scannedDocument(): OpenApiDocument {
    return {
        paths: {
            '/api/auth/me': { get: scanned('200') },
            '/api/auth/login': { post: scanned('201') },
            '/api/auth/logout': { post: scanned('201') },
            '/api/auth/invite/{token}': { get: scanned('200') },
            '/api/auth/invite/accept': { post: scanned('201') },
            '/api/auth/reset/{token}': { get: scanned('200') },
            '/api/auth/reset': { post: scanned('201') },
            '/api/auth/sso': { get: scanned('200') },
            '/api/auth/sso/{provider}/start': { get: scanned('200') },
            '/api/auth/sso/{provider}/callback': {
                get: scanned('200'),
                post: scanned('201')
            },
            '/api/auth/sso/{provider}/backchannel-logout': {
                post: scanned('200')
            },
            '/api/users/{id}/sessions': { get: scanned('200') },
            '/api/users/{id}/sessions/{sessionId}': { delete: scanned('204') },
            '/api/api-tokens': { get: scanned('200'), post: scanned('201') },
            '/api/api-tokens/{id}': { delete: scanned('204') }
        }
    };
}

/** The schema on an operation's success response, or `undefined`. */
function successSchema(
    document: OpenApiDocument,
    route: string,
    method: string
): unknown {
    const operation = document.paths[route]?.[method] as
        | {
              responses?: Record<
                  string,
                  { content?: { 'application/json'?: { schema?: unknown } } }
              >;
          }
        | undefined;
    const responses = operation?.responses ?? {};
    const key = Object.keys(responses).find((code) => /^2\d\d$/.test(code));
    return key
        ? responses[key].content?.['application/json']?.schema
        : undefined;
}

describe('describeIdentityApi', () => {
    it('registers its schemas under components', () => {
        const document = scannedDocument();
        describeIdentityApi(document);
        expect(Object.keys(document.components?.schemas ?? {})).toEqual(
            expect.arrayContaining([
                'AuthenticatedUser',
                'AuthAck',
                'InviteDescription',
                'PasswordResetDescription',
                'SsoProvider',
                'SsoBackchannelLogoutResult',
                'UserSession',
                'ApiToken',
                'MintedApiToken',
                'ApiTokenPage'
            ])
        );
    });

    it('describes the session read and the credential acknowledgements apart', () => {
        const document = scannedDocument();
        describeIdentityApi(document);

        // The hazard this pins: a session is an httpOnly cookie, so login does
        // NOT answer with the user. Describing both with one schema would tell
        // a consumer to read `permissions` off the login response.
        expect(successSchema(document, '/api/auth/me', 'get')).toEqual({
            $ref: '#/components/schemas/AuthenticatedUser'
        });
        expect(successSchema(document, '/api/auth/login', 'post')).toEqual({
            $ref: '#/components/schemas/AuthAck'
        });
    });

    it('writes onto the status code the scanner emitted, never a new one', () => {
        const document = scannedDocument();
        describeIdentityApi(document);

        const login = document.paths['/api/auth/login']['post'] as {
            responses: Record<string, unknown>;
        };
        // `POST /auth/login` really answers 201 (Nest's default for @Post).
        expect(Object.keys(login.responses)).toEqual(['201']);

        const me = document.paths['/api/auth/me']['get'] as {
            responses: Record<string, unknown>;
        };
        expect(Object.keys(me.responses)).toEqual(['200']);
    });

    it('leaves 204 operations without a body', () => {
        const document = scannedDocument();
        describeIdentityApi(document);

        expect(
            successSchema(document, '/api/api-tokens/{id}', 'delete')
        ).toBeUndefined();
        expect(
            successSchema(
                document,
                '/api/users/{id}/sessions/{sessionId}',
                'delete'
            )
        ).toBeUndefined();
    });

    it('leaves the redirecting SSO routes undescribed', () => {
        const document = scannedDocument();
        describeIdentityApi(document);

        // These answer 302 with a Location and no body; the 200/201 the scanner
        // emitted is an artefact of their `Promise<void>` handlers. Attaching a
        // JSON schema would document a payload that never arrives.
        expect(
            successSchema(document, '/api/auth/sso/{provider}/start', 'get')
        ).toBeUndefined();
        expect(
            successSchema(document, '/api/auth/sso/{provider}/callback', 'get')
        ).toBeUndefined();
        expect(
            successSchema(document, '/api/auth/sso/{provider}/callback', 'post')
        ).toBeUndefined();
        // The back-channel notification is the one SSO route that answers JSON.
        expect(
            successSchema(
                document,
                '/api/auth/sso/{provider}/backchannel-logout',
                'post'
            )
        ).toEqual({ $ref: '#/components/schemas/SsoBackchannelLogoutResult' });
    });

    it('mints and lists tokens with different schemas', () => {
        const document = scannedDocument();
        describeIdentityApi(document);

        // The secret exists in exactly one response in the API. One schema with
        // an optional field would suggest the list might carry it too.
        expect(successSchema(document, '/api/api-tokens', 'post')).toEqual({
            $ref: '#/components/schemas/MintedApiToken'
        });
        expect(successSchema(document, '/api/api-tokens', 'get')).toEqual({
            $ref: '#/components/schemas/ApiTokenPage'
        });
    });

    it('claims only the /users tails identity actually serves', () => {
        const document: OpenApiDocument = {
            paths: {
                '/api/users': { get: scanned('200') },
                '/api/users/{id}': { get: scanned('200') },
                '/api/users/{id}/sessions': { get: scanned('200') }
            }
        };
        describeIdentityApi(document);

        // The users plugin owns the directory routes and describes them itself.
        expect(successSchema(document, '/api/users', 'get')).toBeUndefined();
        expect(
            successSchema(document, '/api/users/{id}', 'get')
        ).toBeUndefined();
        expect(
            successSchema(document, '/api/users/{id}/sessions', 'get')
        ).toEqual({
            type: 'array',
            items: { $ref: '#/components/schemas/UserSession' }
        });
    });

    it('does not claim a deeper-prefixed spelling of its own routes', () => {
        // The content plugin's pass once matched `/api/v1/content/...` as well
        // as `/api/content/...` and published the admin's schemas on the public
        // API. The same slip here would put an admin session list on a route
        // answering something else.
        const document: OpenApiDocument = {
            paths: {
                '/api/v1/auth/me': { get: scanned('200') },
                '/api/v1/users/{id}/sessions': { get: scanned('200') }
            }
        };
        describeIdentityApi(document);

        expect(
            successSchema(document, '/api/v1/auth/me', 'get')
        ).toBeUndefined();
        expect(
            successSchema(document, '/api/v1/users/{id}/sessions', 'get')
        ).toBeUndefined();
    });

    it('leaves an unrelated plugin’s routes alone', () => {
        const document: OpenApiDocument = {
            paths: {
                '/api/workspaces': { get: scanned('200') },
                '/api/media/assets': { get: scanned('200') }
            }
        };
        describeIdentityApi(document);

        expect(
            successSchema(document, '/api/workspaces', 'get')
        ).toBeUndefined();
        expect(
            successSchema(document, '/api/media/assets', 'get')
        ).toBeUndefined();
    });
});

describe('tailAfter', () => {
    it('accepts one prefix segment or none, and nothing deeper', () => {
        expect(tailAfter('/api/auth/me', 'auth')).toBe('/me');
        expect(tailAfter('/auth/me', 'auth')).toBe('/me');
        expect(tailAfter('/api/auth', 'auth')).toBe('');
        expect(tailAfter('/api/v1/auth/me', 'auth')).toBeUndefined();
        expect(tailAfter('/api/authors/1', 'auth')).toBeUndefined();
        expect(tailAfter('/api/oauth/me', 'auth')).toBeUndefined();
    });

    it('treats a hyphenated segment literally', () => {
        expect(tailAfter('/api/api-tokens', 'api-tokens')).toBe('');
        expect(tailAfter('/api/api-tokens/{id}', 'api-tokens')).toBe('/{id}');
    });
});
