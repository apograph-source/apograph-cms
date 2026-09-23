import { describe, expect, it } from 'vitest';
import { Email } from './index';

/**
 * The client-side email rule behind the login field. It is a *format* gate for
 * instant feedback, not the authority — the server decides whether an address
 * exists — so what matters here is that it accepts everything the server would
 * and stays strict about the two things the field can get wrong: shape, and the
 * 320-character cap the server's column enforces.
 */
describe('Email', () => {
    describe('isValid', () => {
        it.each([
            'a@b.co',
            'ada@orthacms.dev',
            'ada.lovelace+invites@mail.example.co.uk',
            "o'hara@example.com",
            'ADA@ORTHACMS.DEV',
            'ünïcode@exämple.dev'
        ])('accepts %s', (value) => {
            expect(Email.isValid(value)).toBe(true);
        });

        it.each([
            ['an empty string', ''],
            ['no domain at all', 'notanemail'],
            ['a domain with no dot', 'ada@localhost'],
            ['no local part', '@orthacms.dev'],
            ['no domain after the @', 'ada@'],
            ['a leading space', ' ada@orthacms.dev'],
            // The browser strips a trailing space from `<input type="email">`
            // before the validator ever sees it, so this can only be reached
            // programmatically — it is still the rule.
            ['a trailing space', 'ada@orthacms.dev '],
            ['an inner space', 'ada lovelace@orthacms.dev'],
            ['two @ signs', 'ada@@orthacms.dev'],
            ['only whitespace', '   ']
        ])('rejects %s', (_case, value) => {
            expect(Email.isValid(value)).toBe(false);
        });

        // The cap mirrors the server's column limit. The client is the stricter
        // of the two here (the server's `@IsEmail()` has no length rule), which
        // is the safe direction — it can only refuse to send something the
        // server would have refused to store.
        it('accepts an address of exactly 320 characters', () => {
            const local = 'a'.repeat(320 - '@orthacms.dev'.length);
            const value = `${local}@orthacms.dev`;

            expect(value).toHaveLength(320);
            expect(Email.isValid(value)).toBe(true);
        });

        it('rejects an address of 321 characters', () => {
            const local = 'a'.repeat(321 - '@orthacms.dev'.length);
            const value = `${local}@orthacms.dev`;

            expect(value).toHaveLength(321);
            expect(Email.isValid(value)).toBe(false);
        });

        // The length check runs before the pattern, so a pathological value can
        // never reach the regex — no catastrophic backtracking on a field that
        // validates on every keystroke.
        it('rejects a very long value without hanging', () => {
            const started = Date.now();

            expect(Email.isValid(`${'a'.repeat(100_000)}@orthacms.dev`)).toBe(
                false
            );

            expect(Date.now() - started).toBeLessThan(1_000);
        });
    });

    describe('create', () => {
        it('wraps a valid address and exposes it unchanged', () => {
            expect(Email.create('ada@orthacms.dev').value).toBe(
                'ada@orthacms.dev'
            );
        });

        it('does not normalize case or whitespace — it only validates', () => {
            expect(Email.create('ADA@Orthacms.dev').value).toBe(
                'ADA@Orthacms.dev'
            );
        });

        it('throws on an invalid address, naming the value', () => {
            expect(() => Email.create('notanemail')).toThrow(
                'Invalid email: "notanemail"'
            );
        });

        it('throws on an empty address', () => {
            expect(() => Email.create('')).toThrow();
        });
    });
});
