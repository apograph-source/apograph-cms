import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import { describeUsersApi, memberRouteTail } from './describe-users-api';

/** An operation as the scanner leaves it: a status code and nothing else. */
function scanned(code: string): Record<string, unknown> {
    return { responses: { [code]: { description: '' } } };
}

/** The shape `@nestjs/swagger` produces for this plugin before the pass runs. */
function scannedDocument(): OpenApiDocument {
    return {
        paths: {
            '/api/users': { get: scanned('200') },
            '/api/users/invites': { post: scanned('201') },
            '/api/users/{id}': { get: scanned('200'), patch: scanned('200') },
            '/api/users/{id}/disable': { post: scanned('201') },
            '/api/users/{id}/enable': { post: scanned('201') },
            '/api/users/{id}/invites': { delete: scanned('204') },
            '/api/users/{id}/invites/resend': { post: scanned('201') },
            '/api/users/{id}/password-reset': { post: scanned('201') },
            // Identity's, mounted on the same prefix.
            '/api/users/{id}/sessions': { get: scanned('200') },
            '/api/users/{id}/sessions/{sessionId}': { delete: scanned('204') }
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

describe('describeUsersApi', () => {
    it('registers its schemas under components', () => {
        const document = scannedDocument();
        describeUsersApi(document);
        expect(Object.keys(document.components?.schemas ?? {})).toEqual(
            expect.arrayContaining([
                'Member',
                'MemberRole',
                'MemberWorkspace',
                'MemberPage',
                'InvitedMember',
                'PasswordResetMember'
            ])
        );
    });

    it('describes every member operation that has a body', () => {
        const document = scannedDocument();
        describeUsersApi(document);

        expect(successSchema(document, '/api/users', 'get')).toEqual({
            $ref: '#/components/schemas/MemberPage'
        });
        expect(successSchema(document, '/api/users/{id}', 'get')).toEqual({
            $ref: '#/components/schemas/Member'
        });
        expect(successSchema(document, '/api/users/{id}', 'patch')).toEqual({
            $ref: '#/components/schemas/Member'
        });
        expect(
            successSchema(document, '/api/users/{id}/disable', 'post')
        ).toEqual({ $ref: '#/components/schemas/Member' });
        expect(
            successSchema(document, '/api/users/{id}/enable', 'post')
        ).toEqual({ $ref: '#/components/schemas/Member' });
    });

    it('gives the two token-revealing routes their own schemas', () => {
        const document = scannedDocument();
        describeUsersApi(document);

        // A one-time token is not an optional field on the shared view: it is
        // returned by exactly these routes and never readable again.
        expect(successSchema(document, '/api/users/invites', 'post')).toEqual({
            $ref: '#/components/schemas/InvitedMember'
        });
        expect(
            successSchema(document, '/api/users/{id}/invites/resend', 'post')
        ).toEqual({ $ref: '#/components/schemas/InvitedMember' });
        expect(
            successSchema(document, '/api/users/{id}/password-reset', 'post')
        ).toEqual({ $ref: '#/components/schemas/PasswordResetMember' });
    });

    it('writes onto the status code the scanner emitted, never a new one', () => {
        const document = scannedDocument();
        describeUsersApi(document);

        const enable = document.paths['/api/users/{id}/enable']['post'] as {
            responses: Record<string, unknown>;
        };
        expect(Object.keys(enable.responses)).toEqual(['201']);
    });

    it('leaves the 204 revoke without a body', () => {
        const document = scannedDocument();
        describeUsersApi(document);
        expect(
            successSchema(document, '/api/users/{id}/invites', 'delete')
        ).toBeUndefined();
    });

    it('leaves identity’s session routes to identity', () => {
        const document = scannedDocument();
        describeUsersApi(document);

        // Both plugins mount under /api/users. Claiming a tail this plugin does
        // not serve would publish a member view on a session list.
        expect(
            successSchema(document, '/api/users/{id}/sessions', 'get')
        ).toBeUndefined();
        expect(
            successSchema(
                document,
                '/api/users/{id}/sessions/{sessionId}',
                'delete'
            )
        ).toBeUndefined();
    });

    it('does not claim a deeper-prefixed spelling of its own routes', () => {
        const document: OpenApiDocument = {
            paths: { '/api/v1/users/{id}': { get: scanned('200') } }
        };
        describeUsersApi(document);
        expect(
            successSchema(document, '/api/v1/users/{id}', 'get')
        ).toBeUndefined();
    });
});

describe('memberRouteTail', () => {
    it('accepts one prefix segment or none, and nothing deeper', () => {
        expect(memberRouteTail('/api/users')).toBe('');
        expect(memberRouteTail('/users/{id}')).toBe('/{id}');
        expect(memberRouteTail('/api/users/{id}')).toBe('/{id}');
        expect(memberRouteTail('/api/v1/users/{id}')).toBeUndefined();
        expect(memberRouteTail('/api/workspaces/{id}/members')).toBeUndefined();
    });
});
