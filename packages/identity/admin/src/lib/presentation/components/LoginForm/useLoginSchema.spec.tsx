import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { IntlProvider } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { useLoginSchema } from './useLoginSchema';

/** The schema as the form gets it, with the English default copy resolved. */
function loginSchema() {
    const { result } = renderHook(() => useLoginSchema(), {
        wrapper: ({ children }: { children: ReactNode }) => (
            <IntlProvider locale="en" onError={() => undefined}>
                {children}
            </IntlProvider>
        )
    });

    return result.current;
}

/** Every message the schema reports for `field`, in order. */
function messagesFor(
    field: 'email' | 'password',
    values: { email: string; password: string }
): string[] {
    const result = loginSchema().safeParse(values);
    if (result.success) {
        return [];
    }

    return result.error.issues
        .filter((issue) => issue.path[0] === field)
        .map((issue) => issue.message);
}

/**
 * The sign-in form's validation. It is a courtesy gate — the server decides
 * whether credentials are real, and answers a bad one with a deliberately
 * uninformative `401` — so its only job is to catch the two mistakes worth
 * catching before a round trip, and to say **one** thing about each.
 *
 * That "one thing" is the invariant under test. Zod v4 runs every check on a
 * field, so an empty email box would otherwise answer "Email is required" and
 * "Enter a valid email address" at once, in a single `role="alert"` — telling
 * someone to fix the format of an address they have not typed yet.
 */
describe('useLoginSchema', () => {
    describe('email', () => {
        it('asks for an email once, not once per rule', () => {
            expect(
                messagesFor('email', { email: '', password: 'hunter2' })
            ).toEqual(['Email is required']);
        });

        it.each([
            ['no domain at all', 'notanemail'],
            ['a domain with no dot', 'ada@localhost'],
            ['no local part', '@ortha.dev'],
            ['an inner space', 'ada lovelace@ortha.dev']
        ])('reports the format of %s', (_case, email) => {
            expect(
                messagesFor('email', { email, password: 'hunter2' })
            ).toEqual(['Enter a valid email address']);
        });

        it('accepts a well-shaped address', () => {
            expect(
                messagesFor('email', {
                    email: 'ada@ortha.dev',
                    password: 'hunter2'
                })
            ).toEqual([]);
        });
    });

    describe('password', () => {
        // No length rule on the way in: the account may predate today's floor,
        // and the server is the one that decides. An empty box is the only
        // thing worth stopping.
        it('asks for a password when the box is empty', () => {
            expect(
                messagesFor('password', {
                    email: 'ada@ortha.dev',
                    password: ''
                })
            ).toEqual(['Password is required']);
        });

        it('does not second-guess the length of an existing password', () => {
            expect(
                messagesFor('password', {
                    email: 'ada@ortha.dev',
                    password: 'x'
                })
            ).toEqual([]);
        });
    });

    it('reports both fields when both are empty, one message each', () => {
        const result = loginSchema().safeParse({ email: '', password: '' });

        expect(result.success).toBe(false);
        expect(result.error?.issues.map((issue) => issue.message)).toEqual([
            'Email is required',
            'Password is required'
        ]);
    });
});
