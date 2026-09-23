import { createTestkitMailProvider } from '@orthacms/mail-provider-testkit';
import type { MailProvider } from '@orthacms/mail-domain';
import { MailServerPlugin, type MailPluginOptions } from './mail-plugin';

const config = {
    appUrl: 'https://cms.example.com',
    from: 'Ortha CMS <no-reply@example.com>'
};

const options = (overrides: Partial<MailPluginOptions> = {}) =>
    ({
        provider: createTestkitMailProvider(),
        config,
        ...overrides
    }) as MailPluginOptions;

describe('MailServerPlugin', () => {
    it('is a plugin named `mail` that ships its own migrations', () => {
        const plugin = MailServerPlugin(options());

        expect(plugin.name).toBe('mail');
        expect(plugin.migrations?.table).toBe('__drizzle_migrations_mail');
        expect(plugin.migrations?.dir()).toMatch(/migrations$/);
    });

    it('carries the config it was constructed with', () => {
        expect(MailServerPlugin(options()).mailConfig).toBe(config);
    });

    it('refuses a plugin with no provider at all', () => {
        expect(() =>
            MailServerPlugin(options({ provider: undefined as never }))
        ).toThrow(/requires a mail provider/);
    });

    it('refuses a provider that cannot be recorded on a row', () => {
        expect(() =>
            MailServerPlugin(
                options({
                    provider: { ...createTestkitMailProvider(), id: '  ' }
                })
            )
        ).toThrow(/non-empty `id`/);
    });

    it('refuses a provider that declares nothing about itself', () => {
        const provider = {
            id: 'mystery',
            send: async () => ({})
        } as unknown as MailProvider;
        expect(() => MailServerPlugin(options({ provider }))).toThrow(
            /declares no `capabilities`/
        );
    });

    it('refuses a verifiable provider with no verify()', () => {
        const provider = {
            id: 'half-done',
            capabilities: { messageId: false, verifiable: true },
            send: async () => ({})
        } as unknown as MailProvider;
        expect(() => MailServerPlugin(options({ provider }))).toThrow(
            /implements\s+no `verify\(\)`/
        );
    });

    it('refuses a configuration with no app URL to build links from', () => {
        expect(() =>
            MailServerPlugin(
                options({ config: { ...config, appUrl: '/admin' } })
            )
        ).toThrow(/absolute URL/);
    });

    it('refuses a configuration with no sender', () => {
        expect(() =>
            MailServerPlugin(options({ config: { ...config, from: '' } }))
        ).toThrow(/requires a `from` address/);
    });

    it.each([
        ['batchSize', { batchSize: 0 }],
        ['maxAttempts', { maxAttempts: -1 }],
        ['claimLeaseMs', { claimLeaseMs: 0 }],
        ['sweepIntervalMs', { sweepIntervalMs: 0.5 }]
    ])('refuses a %s that would stall the worker', (key, overrides) => {
        expect(() =>
            MailServerPlugin(options({ config: { ...config, ...overrides } }))
        ).toThrow(new RegExp(`${key} must be a positive integer`));
    });

    it('accepts deliveryIntervalMs 0, which is "do not send from here"', () => {
        expect(() =>
            MailServerPlugin(
                options({ config: { ...config, deliveryIntervalMs: 0 } })
            )
        ).not.toThrow();
        expect(() =>
            MailServerPlugin(
                options({ config: { ...config, deliveryIntervalMs: -1 } })
            )
        ).toThrow(/non-negative integer/);
    });
});
