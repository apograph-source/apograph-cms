import { join } from 'node:path';
import type { ServerPlugin } from '@orthacms/bootstrap-server';
import { AlarmsModule } from '../alarms.module';
import { describeAlarmsApi } from '../docs/describe-alarms-api';
import type { AlarmsPluginConfig } from '../types/alarms-config';

/** The alarms plugin, carrying its config alongside the standard shape. */
export interface AlarmsServerPluginType extends ServerPlugin {
    /** The configuration this plugin was constructed with. */
    alarmsConfig: AlarmsPluginConfig;
}

/**
 * Rejects a configuration that would silently do nothing.
 *
 * Every value here bounds work, and a zero or negative bound does not mean
 * "unlimited" — it means a scan that examines no rows and reports a clean
 * collection. That is the one failure mode this plugin must never have, so it
 * is caught at construction rather than discovered from a suspiciously empty
 * alarms page. `sweepIntervalMinutes` is the exception: zero is a real choice
 * there ("do not sweep"), so only a negative value is refused.
 */
function assertConfig(config: AlarmsPluginConfig): void {
    const positive: Array<[keyof AlarmsPluginConfig, number | undefined]> = [
        ['maxScanEntries', config.maxScanEntries],
        ['scanBatchSize', config.scanBatchSize],
        ['maxDependentsPerEvent', config.maxDependentsPerEvent]
    ];
    for (const [key, value] of positive) {
        if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
            throw new Error(
                `AlarmsPlugin: ${String(key)} must be a positive integer; got ${value}.`
            );
        }
    }
    const sweep = config.sweepIntervalMinutes;
    if (sweep !== undefined && (!Number.isInteger(sweep) || sweep < 0)) {
        throw new Error(
            'AlarmsPlugin: sweepIntervalMinutes must be a non-negative integer ' +
                `(0 disables the sweep); got ${sweep}.`
        );
    }
}

/**
 * Creates the alarms plugin — non-blocking content rules and their findings.
 *
 * Register it **after** `ContentPlugin`, whose registry, filter surface and
 * grant query it uses, and after `DatabasePlugin` (the outbox it subscribes to
 * and the client it injects). It owns two tables — `alarm_rules` and
 * `alarm_findings` — and ships their migrations, tracked under its own table.
 *
 * It never blocks a write. A rule produces findings; a finding is information.
 * See [ADR-0015](../../../../../docs/adr/0015-alarms-are-non-blocking.md) for
 * why that is a rule rather than a current limitation.
 *
 * @example
 * ```typescript
 * createServer({
 *   plugins: [
 *     DatabasePlugin({ connectionString: config.database.url }),
 *     IdentityPlugin(config.plugins.identity),
 *     ContentPlugin({ types: contentTypes }),
 *     AlarmsPlugin({ sweepIntervalMinutes: 60 })
 *   ]
 * });
 * ```
 */
export function AlarmsPlugin(
    config: AlarmsPluginConfig = {}
): AlarmsServerPluginType {
    assertConfig(config);
    return {
        name: 'alarms',
        module: AlarmsModule.forRoot(config),
        alarmsConfig: config,
        migrations: {
            dir: () => join(__dirname, '../../../migrations'),
            table: '__drizzle_migrations_alarms'
        },
        // The response views are `interface`s and the stored filter is a
        // recursive tree, neither of which `@nestjs/swagger` can see. This hook
        // is where the reference learns both.
        docs: { decorate: describeAlarmsApi }
    };
}
