import {
    ACCEPT_INVITE_PATH,
    RESET_PASSWORD_PATH,
    assertAppUrl,
    inviteLink,
    passwordResetLink
} from './links';

describe('the links a message carries', () => {
    // covers: mail:I-11
    it('are built from appUrl and carry the token', () => {
        expect(inviteLink('https://cms.example.com', 'abc123')).toBe(
            'https://cms.example.com/identity/accept-invite?token=abc123'
        );
        expect(passwordResetLink('https://cms.example.com', 'abc123')).toBe(
            'https://cms.example.com/identity/reset-password?token=abc123'
        );
    });

    it('keep a path the deployment already serves the admin under', () => {
        // `new URL('identity/…', 'https://x/admin')` would drop `/admin`; the
        // builder normalises the base so a sub-path install still works.
        expect(inviteLink('https://example.com/admin', 'tkn')).toBe(
            'https://example.com/admin/identity/accept-invite?token=tkn'
        );
        expect(inviteLink('https://example.com/admin/', 'tkn')).toBe(
            'https://example.com/admin/identity/accept-invite?token=tkn'
        );
    });

    it('percent-encode a token so it survives the query string', () => {
        expect(inviteLink('https://example.com', 'a b&c=d')).toBe(
            'https://example.com/identity/accept-invite?token=a+b%26c%3Dd'
        );
    });

    it('point at the routes the admin actually mounts', () => {
        expect(ACCEPT_INVITE_PATH).toBe('identity/accept-invite');
        expect(RESET_PASSWORD_PATH).toBe('identity/reset-password');
    });
});

describe('assertAppUrl', () => {
    it('accepts an absolute http(s) URL', () => {
        expect(() => assertAppUrl('https://cms.example.com')).not.toThrow();
        expect(() => assertAppUrl('http://localhost:4200')).not.toThrow();
    });

    it.each([
        ['a relative path', '/admin'],
        ['a bare host', 'cms.example.com'],
        ['an empty string', '']
    ])('refuses %s', (_case, value) => {
        expect(() => assertAppUrl(value)).toThrow(/absolute URL/);
    });

    it('refuses a scheme that cannot serve the admin', () => {
        expect(() => assertAppUrl('ftp://example.com')).toThrow(
            /http or https/
        );
    });

    it('refuses a query string, which the token would collide with', () => {
        expect(() => assertAppUrl('https://example.com/?tenant=a')).toThrow(
            /query string/
        );
    });
});
