import {
    UnknownSsoProviderError,
    type SsoProvider
} from '@apograph/identity-domain';
import { buildSsoRegistry } from './sso-registry';

const provider = (label = 'Fake'): SsoProvider => ({
    descriptor: () => ({ kind: 'oidc', label, callbackMethod: 'GET' }),
    authorize: () => Promise.resolve({ url: 'https://idp.test/authorize' }),
    complete: () => Promise.reject(new Error('not called'))
});

describe('buildSsoRegistry', () => {
    it('resolves a registered provider by name', () => {
        const google = provider('Google');
        const registry = buildSsoRegistry([
            { name: 'google', provider: google }
        ]);

        expect(registry.get('google')).toBe(google);
        expect(registry.has('google')).toBe(true);
        expect(registry.names()).toEqual(['google']);
    });

    it('names the registered providers when asked for an unknown one', () => {
        const registry = buildSsoRegistry([
            { name: 'google', provider: provider() }
        ]);

        expect(() => registry.get('entra')).toThrow(UnknownSsoProviderError);
        expect(() => registry.get('entra')).toThrow(
            /Unknown SSO provider "entra"\. Registered: google/
        );
    });

    it('does not resolve inherited Object properties as providers', () => {
        const registry = buildSsoRegistry([
            { name: 'fake', provider: provider() }
        ]);

        expect(registry.has('toString')).toBe(false);
        expect(() => registry.get('constructor')).toThrow(
            UnknownSsoProviderError
        );
    });

    it('renders the catalogue in registration order', () => {
        const registry = buildSsoRegistry([
            { name: 'google', provider: provider('Google') },
            { name: 'entra', provider: provider('Microsoft') }
        ]);

        expect(registry.catalogue()).toEqual([
            { name: 'google', label: 'Google', kind: 'oidc' },
            { name: 'entra', label: 'Microsoft', kind: 'oidc' }
        ]);
    });

    it('snapshots the list, so a later mutation cannot reroute a sign-in', () => {
        const original = provider('Google');
        const registrations = [{ name: 'google', provider: original }];
        const registry = buildSsoRegistry(registrations);

        registrations[0] = { name: 'google', provider: provider('Evil') };

        expect(registry.get('google')).toBe(original);
    });

    it.each([
        ['a blank name', ' '],
        ['a slash', 'google/oauth'],
        ['an upper-case letter', 'Google'],
        ['a percent escape', 'goo%2fgle'],
        ['a leading hyphen', '-google']
    ])('refuses %s', (_label, name) => {
        expect(() =>
            buildSsoRegistry([{ name, provider: provider() }])
        ).toThrow();
    });

    it('refuses a duplicate name', () => {
        expect(() =>
            buildSsoRegistry([
                { name: 'google', provider: provider() },
                { name: 'google', provider: provider() }
            ])
        ).toThrow(/Duplicate SSO provider name "google"/);
    });
});
