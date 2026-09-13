import { InvalidEmailError } from '../errors';
import { Email } from './email';

/**
 * The domain side of the identity dossier's I-12 — the login email is unique
 * case-insensitively at the database level, and the value object is what makes
 * that index agree with domain equality: it normalizes on construction, so
 * `ADA@Apograph.DEV` and `ada@apograph.dev` are one address everywhere above the SQL.
 * Uncited on purpose — drop the unique index and every test below still passes,
 * so I-12 is pinned against a real schema in
 * `apps/server-e2e/src/server/auth/email-uniqueness.spec.ts`. The shape check is deliberately lenient
 * (delivery is the authoritative test), but it still has to reject an address
 * with no domain, since that is a typo rather than an exotic address.
 */
describe('Email', () => {
    describe('create', () => {
        it('trims and lower-cases the address', () => {
            expect(Email.create(' ADA@Apograph.DEV ').value).toBe(
                'ada@apograph.dev'
            );
        });

        it.each([
            'ada@apograph.dev',
            'ada.lovelace@apograph.dev',
            'ada+invites@mail.apograph.co.uk'
        ])('accepts %p', (value) => {
            expect(Email.create(value).value).toBe(value);
        });

        it.each([
            ['a dotless domain', 'ada@localhost'],
            ['an empty domain', 'ada@'],
            ['a space in the local part', 'a b@c.d'],
            ['an empty string', ''],
            ['blank input', '   '],
            ['no at sign', 'ada.apograph.dev'],
            ['an empty local part', '@apograph.dev'],
            ['two at signs', 'ada@@apograph.dev']
        ])('rejects %s', (_case, value) => {
            expect(() => Email.create(value)).toThrow(InvalidEmailError);
        });
    });

    describe('equals', () => {
        it('is structural on the normalized address', () => {
            expect(
                Email.create('ADA@Apograph.dev').equals(
                    Email.create(' ada@apograph.dev ')
                )
            ).toBe(true);
            expect(
                Email.create('ada@apograph.dev').equals(
                    Email.create('grace@apograph.dev')
                )
            ).toBe(false);
        });
    });
});
