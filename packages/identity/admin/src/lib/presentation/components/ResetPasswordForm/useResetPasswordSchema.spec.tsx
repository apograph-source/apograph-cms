import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { IntlProvider } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { useResetPasswordSchema } from './useResetPasswordSchema';

/** The schema as the form gets it, with the English default copy resolved. */
function resetPasswordSchema() {
    const { result } = renderHook(() => useResetPasswordSchema(), {
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
    field: 'password' | 'confirmPassword',
    values: { password: string; confirmPassword: string }
): string[] {
    const result = resetPasswordSchema().safeParse(values);
    if (result.success) {
        return [];
    }

    return result.error.issues
        .filter((issue) => issue.path[0] === field)
        .map((issue) => issue.message);
}

/** A confirm field that always agrees, so only the password rule is in play. */
function bothFields(password: string) {
    return { password, confirmPassword: password };
}

/**
 * The reset form's validation.
 *
 * The rules mirror `useAcceptInviteSchema` because they mirror the same
 * server-side bounds — the two forms set the same column through two different
 * one-time tokens — so this suite mirrors that one. It is not redundant: the
 * two schemas are separate objects with their own message catalogues, and the
 * whole point of the pairing is that they cannot be allowed to drift.
 *
 * The stakes are higher here than on the invite path. A reset link is spent by
 * the request that uses it, so a form that green-lights something the server
 * rejects does not merely bounce the visitor back to the field — it costs them
 * the link, and only an administrator can issue another.
 */
describe('useResetPasswordSchema', () => {
    describe('password', () => {
        it('asks for a password once, not once per length rule', () => {
            expect(messagesFor('password', bothFields(''))).toEqual([
                'Choose a new password to finish resetting your account'
            ]);
        });

        it('rejects 11 characters as too short', () => {
            expect(messagesFor('password', bothFields('a'.repeat(11)))).toEqual(
                [
                    'Use at least 12 characters — length is what keeps a password hard to guess'
                ]
            );
        });

        it('accepts 12 characters — the floor is inclusive', () => {
            expect(messagesFor('password', bothFields('a'.repeat(12)))).toEqual(
                []
            );
        });

        it('accepts 72 ASCII characters, which is exactly 72 bytes', () => {
            expect(messagesFor('password', bothFields('a'.repeat(72)))).toEqual(
                []
            );
        });

        // 72 characters, 144 bytes: the case a `.max(72)` on length would wave
        // through and bcrypt would then silently truncate in half.
        it('rejects 72 accented characters, because the ceiling counts bytes', () => {
            expect(messagesFor('password', bothFields('é'.repeat(72)))).toEqual(
                [
                    'Keep it under 72 bytes — accented letters and emoji each count for more than one'
                ]
            );
        });

        it('rejects 73 ASCII characters', () => {
            expect(messagesFor('password', bothFields('a'.repeat(73)))).toEqual(
                [
                    'Keep it under 72 bytes — accented letters and emoji each count for more than one'
                ]
            );
        });

        // 36 accented characters is 72 bytes: a non-ASCII passphrase that fits
        // must not be rejected merely for being non-ASCII.
        it('accepts a passphrase whose bytes fit even though it is not ASCII', () => {
            expect(messagesFor('password', bothFields('é'.repeat(36)))).toEqual(
                []
            );
        });
    });

    describe('confirmPassword', () => {
        // One message, not two — see the note on the same test in
        // `useAcceptInviteSchema.spec.tsx`. An object-level `.refine` still
        // runs when a field-level check on the same path has already failed,
        // so it has to skip an empty box or the field accuses the visitor of a
        // mismatch before they have typed a second password.
        it('asks for the confirmation once, not once per rule', () => {
            expect(
                messagesFor('confirmPassword', {
                    password: 'a'.repeat(12),
                    confirmPassword: ''
                })
            ).toEqual(['Type your new password once more to confirm it']);
        });

        it('says nothing about a mismatch when both boxes are empty', () => {
            expect(
                messagesFor('confirmPassword', {
                    password: '',
                    confirmPassword: ''
                })
            ).toEqual(['Type your new password once more to confirm it']);
        });

        // The mismatch is reported on the confirm field, not the password one:
        // that is the box to go back and retype, and it is where the form
        // renders the error.
        it('reports a mismatch against the confirm field', () => {
            const result = resetPasswordSchema().safeParse({
                password: 'correct horse battery',
                confirmPassword: 'correct horse batttery'
            });

            expect(result.success).toBe(false);
            expect(result.error?.issues).toEqual([
                expect.objectContaining({
                    path: ['confirmPassword'],
                    message: expect.stringContaining('don’t match')
                })
            ]);
        });

        it('accepts two identical passwords', () => {
            expect(
                resetPasswordSchema().safeParse({
                    password: 'correct horse battery',
                    confirmPassword: 'correct horse battery'
                }).success
            ).toBe(true);
        });
    });
});
