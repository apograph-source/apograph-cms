import config from '../ortha.config';
import { buildPlugins } from './plugins';

/**
 * This app's composition, asserted.
 *
 * Two things about the plugin list are load-bearing, and neither shows up in an
 * end-to-end run:
 *
 * 1. **Who is in it.** Drop a plugin and its routes stop existing, while
 *    everything that injects its ports `@Optional()` degrades silently — no
 *    error, no log, just a capability that quietly went away.
 * 2. **What order the migrations run in.** They are applied by walking this
 *    array with no transaction spanning plugins, so a plugin whose tables
 *    reference another's must come after it. The mistake is invisible on an
 *    already-migrated database and fails a *fresh* one, so it ships and bites
 *    the next clean install rather than its author.
 *
 * Deliberately *not* asserted: relative order beyond the migration constraint.
 * Every plugin module is global and every `onPluginInit` runs before the Nest
 * app is created, so DI order is genuinely free.
 */

// ortha:if mail
/**
 * Mail is registered only when `MAIL_PROVIDER` names a backend — see
 * `config/mail.ts`. So the expected list follows the same condition rather than
 * asserting a plugin whose presence is a `.env` decision: an app that sends
 * nothing is a valid app, and this spec has to be green in both states.
 */
const mailIfConfigured = config.plugins.mail ? ['mail'] : [];
// ortha:end

/** Every plugin this app registers, in order. */
const EXPECTED_PLUGINS = [
    'database',
    'identity',
    'workspaces',
    'activity',
    // ortha:if mail
    // Before `users`, whose invite, resend and reset queue through the port
    // mail binds — and mail owns `mail_deliveries`, so this is migration order
    // as much as intent.
    ...mailIfConfigured,
    // ortha:end
    'users',
    'content',
    // A second entry from the content package: `ServerPlugin.migrations` holds
    // one descriptor per entry, and saved list views ship their own tables.
    'content-views',
    // ortha:if graphql
    'content-graphql',
    // ortha:end
    'i18n',
    'alarms',
    'webhooks',
    'media',
    'transfer',
    'segments',
    'protection',
    'copilot'
    // ortha:if mcp
    ,
    'mcp'
    // ortha:end
];

describe('buildPlugins()', () => {
    it('registers exactly the plugins this app ships', () => {
        expect(buildPlugins(config).map((plugin) => plugin.name)).toEqual(
            EXPECTED_PLUGINS
        );
    });

    it('orders the migrating plugins so their foreign keys resolve on a fresh database', () => {
        const migrating = buildPlugins(config)
            .filter((plugin) => plugin.migrations)
            .map((plugin) => plugin.name);

        // `workspaces.memberships` references `identity.users`. Reverse these
        // and a fresh migrate fails with `relation "users" does not exist`,
        // while an existing database migrates perfectly happily.
        expect(migrating.indexOf('identity')).toBeLessThan(
            migrating.indexOf('workspaces')
        );
    });

    it('opens the database before anything that needs it', () => {
        // Not a DI requirement — every `onPluginInit` runs before the app is
        // created — but `database` is the only plugin that opens a resource,
        // and the moment a second one does, this position becomes load-bearing
        // with nothing else to catch a mistake.
        expect(buildPlugins(config)[0]?.name).toBe('database');
    });
});
