import { ApiError, apiClient } from '@orthacms/utils-admin';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { httpAuthGateway } from './index';

// Only the wire is stubbed: `toApiError`, `ApiError` and `HTTP_STATUS` stay
// real, because how a failure is classified is precisely what is under test.
vi.mock('@orthacms/utils-admin', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@orthacms/utils-admin')>()),
    apiClient: { get: vi.fn(), post: vi.fn() }
}));

const get = vi.mocked(apiClient.get);

/**
 * A failure shaped the way axios rejects: `isAxiosError` recognizes it, so
 * `toApiError` takes the "the server answered" branch and keeps the status.
 */
function respondedWith(status: number) {
    return {
        isAxiosError: true,
        message: `Request failed with status code ${status}`,
        response: { status, data: { message: 'nope' } }
    };
}

/** A failure with no response at all — the network never reached the server. */
function neverReachedTheServer() {
    return {
        isAxiosError: true,
        message: 'Network Error',
        response: undefined
    };
}

/**
 * The HTTP side of the auth port. Two behaviours here are not transport detail
 * but the source of a decision the whole admin shell is built on.
 *
 * `getCurrentUser` is where "not signed in" and "we can't tell" are split
 * apart. A `401` is the ordinary signed-out answer and resolves to `null`, so
 * the route gate can send the visitor to the sign-in form; anything else — a
 * `500`, a dead network — must throw, because a proxy hiccup that resolved to
 * `null` would look exactly like a sign-out and eject someone who is in fact
 * still signed in. Upstream that is the difference between the *unauthenticated*
 * and *unavailable* states.
 *
 * `describeInvite` puts caller-supplied text into a URL path, which is the one
 * place in this file a value can change the shape of the request.
 */
describe('httpAuthGateway', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getCurrentUser', () => {
        it('returns the user the probe answered with', async () => {
            get.mockResolvedValue({ data: { id: 'usr_1' } });

            await expect(httpAuthGateway.getCurrentUser()).resolves.toEqual({
                id: 'usr_1'
            });
            expect(get).toHaveBeenCalledWith('/auth/me');
        });

        it('resolves null on a 401 — nobody is signed in, which is not an error', async () => {
            get.mockRejectedValue(respondedWith(401));

            await expect(httpAuthGateway.getCurrentUser()).resolves.toBeNull();
        });

        it('throws an ApiError on a 500, so the shell can say "unavailable" instead of signing the visitor out', async () => {
            get.mockRejectedValue(respondedWith(500));

            const error = await httpAuthGateway
                .getCurrentUser()
                .catch((thrown: unknown) => thrown);

            expect(error).toBeInstanceOf(ApiError);
            expect((error as ApiError).status).toBe(500);
        });

        it.each([403, 404, 502, 503])(
            'throws on a %i as well — only a 401 means signed out',
            async (status) => {
                get.mockRejectedValue(respondedWith(status));

                await expect(httpAuthGateway.getCurrentUser()).rejects.toThrow(
                    ApiError
                );
            }
        );

        it('throws when the request never reached the server', async () => {
            get.mockRejectedValue(neverReachedTheServer());

            const error = await httpAuthGateway
                .getCurrentUser()
                .catch((thrown: unknown) => thrown);

            expect(error).toBeInstanceOf(ApiError);
            // No response, so no status to branch on — decidedly not a 401.
            expect((error as ApiError).status).toBeNull();
        });
    });

    describe('describeInvite', () => {
        it('asks for the invite the token names', async () => {
            get.mockResolvedValue({ data: { email: 'ada@ortha.dev' } });

            await httpAuthGateway.describeInvite('tok_1');

            expect(get).toHaveBeenCalledWith('/auth/invite/tok_1');
        });

        // A token arrives from the URL of an emailed link, so it is caller
        // input in a path segment: escaped, it stays one segment; unescaped, a
        // `/` or `?` would silently address a different endpoint.
        it.each([
            ['a slash', 'a/b', '/auth/invite/a%2Fb'],
            ['a query separator', 'a?b=c', '/auth/invite/a%3Fb%3Dc'],
            ['a fragment marker', 'a#b', '/auth/invite/a%23b'],
            ['a space', 'a b', '/auth/invite/a%20b'],
            ['a traversal attempt', '../me', '/auth/invite/..%2Fme']
        ])('escapes %s in the token', async (_case, token, expected) => {
            get.mockResolvedValue({ data: { email: 'ada@ortha.dev' } });

            await httpAuthGateway.describeInvite(token);

            expect(get).toHaveBeenCalledWith(expected);
        });

        it('throws an ApiError when the link is dead', async () => {
            get.mockRejectedValue(respondedWith(404));

            const error = await httpAuthGateway
                .describeInvite('tok_1')
                .catch((thrown: unknown) => thrown);

            expect(error).toBeInstanceOf(ApiError);
            expect((error as ApiError).status).toBe(404);
        });
    });
});
