import { AxiosError, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';
import { ApiError, toApiError } from '.';

function axiosError(
    status: number | null,
    message = 'failed',
    data?: unknown
): AxiosError {
    const config = { url: '/x', headers: {} } as never;
    const response =
        status === null
            ? undefined
            : ({
                  data,
                  status,
                  statusText: '',
                  headers: {},
                  config
              } as unknown as AxiosResponse);
    return new AxiosError(message, 'ERR', config, {}, response);
}

describe('ApiError', () => {
    it('carries the status and the opaque details', () => {
        const error = new ApiError(422, 'nope', { issues: [] });
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('ApiError');
        expect(error.status).toBe(422);
        expect(error.details).toEqual({ issues: [] });
    });

    it('composes a default message from the status', () => {
        expect(new ApiError(500).message).toBe(
            'Request failed with status 500'
        );
        expect(new ApiError(null).message).toBe('Network error');
    });
});

describe('toApiError', () => {
    it('returns the same instance for an ApiError, so wrapping is idempotent', () => {
        const original = new ApiError(404, 'gone');
        expect(toApiError(original)).toBe(original);
        expect(toApiError(toApiError(original))).toBe(original);
    });

    it('unwraps an axios error into status + details', () => {
        const normalized = toApiError(
            axiosError(422, 'Request failed with status code 422', {
                issues: [{ field: 'name', message: 'required' }]
            })
        );
        expect(normalized).toBeInstanceOf(ApiError);
        expect(normalized.status).toBe(422);
        expect(normalized.details).toEqual({
            issues: [{ field: 'name', message: 'required' }]
        });
    });

    it('reports a transport failure as status null with no details [utils:I-09]', () => {
        const normalized = toApiError(axiosError(null, 'Network Error'));
        expect(normalized.status).toBeNull();
        expect(normalized.message).toBe('Network Error');
        expect(normalized.details).toBeUndefined();
    });

    it('leaves the server message in details, not in message', () => {
        const normalized = toApiError(
            axiosError(500, 'Request failed with status code 500', {
                message: 'boom in the service layer'
            })
        );
        expect(normalized.message).toBe('Request failed with status code 500');
        expect(normalized.details).toEqual({
            message: 'boom in the service layer'
        });
    });

    it.each([
        [new Error('x'), 'x'],
        [new TypeError('bad'), 'bad']
    ])(
        'wraps the plain error %j as a null-status ApiError',
        (input, message) => {
            const normalized = toApiError(input);
            expect(normalized.status).toBeNull();
            expect(normalized.message).toBe(message);
            expect(normalized.details).toBeUndefined();
        }
    );

    it.each([undefined, null, 'a string', 42, { status: 500 }])(
        'wraps the non-error thrown value %j without inventing a status',
        (input) => {
            const normalized = toApiError(input);
            expect(normalized).toBeInstanceOf(ApiError);
            expect(normalized.status).toBeNull();
        }
    );
});

describe('what a status is allowed to mean here', () => {
    /** Every code the admin actually sees, including the ones this package branches on. */
    const STATUSES = [400, 401, 403, 404, 409, 422, 429, 500, 503];

    it('composes one sentence shape for every status [utils:I-08]', () => {
        // The transport reports *that* the request failed and with what number.
        // A `401 ? 'Your password is wrong'` here would be wrong twice over: it
        // is wrong on `/auth/me` (the session expired) and it is a user-facing
        // string in a package that ships none — but it would look right in the
        // one flow whose author added it, which is how this kind of branch gets
        // in.
        expect(STATUSES.map((s) => new ApiError(s).message)).toEqual(
            STATUSES.map((s) => `Request failed with status ${s}`)
        );
    });

    it('passes the server’s own answer through, whatever the status [utils:I-08]', () => {
        // The body is opaque: the caller narrows it to its endpoint's error
        // shape. Lifting a 401's `code` into a message here would decide, for
        // every caller at once, what that endpoint's 401 meant.
        for (const status of STATUSES) {
            const body = {
                code: 'SOMETHING_SPECIFIC',
                message: 'from the API'
            };
            const normalized = toApiError(
                axiosError(
                    status,
                    `Request failed with status code ${status}`,
                    body
                )
            );
            expect(normalized.status).toBe(status);
            expect(normalized.message).toBe(
                `Request failed with status code ${status}`
            );
            expect(normalized.details).toBe(body);
        }
    });

    it('reads a 401 exactly as it reads a 403 [utils:I-08]', () => {
        // The one status this package *does* branch on, for transport reasons
        // (the session handler). That branch must leave the error it hands the
        // caller indistinguishable from any other client error's.
        const unauthorized = toApiError(axiosError(401, 'failed', { a: 1 }));
        const forbidden = toApiError(axiosError(403, 'failed', { a: 1 }));

        expect(unauthorized.message).toBe(forbidden.message);
        expect(unauthorized.name).toBe(forbidden.name);
        expect(unauthorized.details).toEqual(forbidden.details);
        expect(unauthorized.status).not.toBe(forbidden.status);
    });
});
