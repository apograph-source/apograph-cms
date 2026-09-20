import type { ServerPlugin } from '@orthacms/bootstrap-server';
import { TransferModule } from '../transfer.module';
import { describeTransferApi } from '../docs/describe-transfer-api';
import type { TransferPluginConfig } from '../types/transfer-config';

/** The transfer plugin, carrying its config alongside the standard shape. */
export interface TransferServerPluginType extends ServerPlugin {
    /** The validated transfer configuration. */
    transferConfig: TransferPluginConfig;
}

/**
 * Validates the config **eagerly**, the way `ContentPlugin` and
 * `I18nServerPlugin` do: an identity list naming no fields is a
 * misconfiguration that would otherwise surface as "every import creates
 * duplicates", months later and nowhere near its cause.
 */
function assertConfig(config: TransferPluginConfig): void {
    for (const [type, fields] of Object.entries(config.identity ?? {})) {
        if (!Array.isArray(fields) || fields.length === 0) {
            throw new Error(
                `TransferPlugin: identity for content type "${type}" is empty. ` +
                    'Name at least one field, or drop the key to use the derived default.'
            );
        }
        const blank = fields.find(
            (field) => typeof field !== 'string' || field.trim() === ''
        );
        if (blank !== undefined) {
            throw new Error(
                `TransferPlugin: identity for content type "${type}" contains a blank field name.`
            );
        }
    }
}

/**
 * Creates the transfer plugin — content export and import.
 *
 * Register it **after** `ContentPlugin` (whose registry and entry writer it
 * uses) and, if you want files to travel, after `MediaServerPlugin`. Without
 * media it still runs: media fields export as references and import reports
 * them as missing, rather than the plugin refusing to boot.
 *
 * Owns **no tables and no migrations**. A transfer reads and writes content
 * that already exists; the only thing it adds is two audit events, which ride
 * the shared outbox.
 *
 * @example
 * ```typescript
 * createServer({
 *   plugins: [
 *     DatabasePlugin({ connectionString: config.database.url }),
 *     IdentityPlugin(config.plugins.identity),
 *     ContentPlugin({ types: contentTypes }),
 *     MediaServerPlugin(config.plugins.media),
 *     TransferPlugin({
 *       identity: { post: ['slug'], author: ['email'] }
 *     })
 *   ]
 * });
 * ```
 */
export function TransferPlugin(
    config: TransferPluginConfig = {}
): TransferServerPluginType {
    assertConfig(config);
    return {
        name: 'transfer',
        module: TransferModule.forRoot(config),
        transferConfig: config,
        // Nothing here is visible to `@nestjs/swagger`: three routes answer
        // framework-free `interface`s from `@orthacms/transfer-domain`, and the
        // two downloads write through `@Res()`, which erases the return type.
        docs: {
            decorate: (document) => describeTransferApi(document)
        }
    };
}
