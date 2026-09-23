/**
 * Typed configuration for this app.
 *
 * **`config/` is the single place that reads the environment**, and it reads it
 * only through the readers in `@orthacms/utils-server` — never `process.env`
 * directly. `readEnv` is where "an empty value means the setting is absent" is
 * decided, and `.env` ships keys with nothing on the right-hand side; a raw
 * `process.env['X'] ?? default` skips that decision and lets a blank line win
 * over the default. Everything
 * downstream — the host, every plugin — receives typed values, so "where does
 * this setting come from" has exactly one answer. Deploy-specific values come
 * from the environment; stable product tuning lives in the builders as literals.
 *
 * **Shape:** one module per plugin under `config/`, each exporting a builder,
 * and this file assembling them. So the literal at the bottom is the table of
 * contents — what this app runs, in one screen — and a reader who wants to know
 * how one setting is derived opens the one module that owns it. Adding a setting
 * means editing one builder; adding a plugin means one module and one line here.
 *
 * *How* a value is parsed is decided in neither place: the readers come from
 * `@orthacms/utils-server`. Each refuses a value it cannot honour instead of
 * guessing, and the guessing is what makes a misconfigured deployment look
 * configured. Anything conditional is a *value* — a builder returns `undefined`
 * for a backend you did not configure, and `defined(…)` drops the keys that were
 * never set, so no config object here needs a `...(x ? { … } : {})` spread.
 *
 * This file stays the entry point rather than becoming another module in the
 * folder: `orthacms start` runs the compiled `dist/server/orthacms.config.js`, and
 * `src/plugins.ts` imports the types below.
 */
import { join } from 'node:path';
import type {
    ApiDocsOptions,
    TrustProxySetting
} from '@orthacms/bootstrap-server';
import type { I18nPluginConfig } from '@orthacms/i18n-server';
import type { SegmentsPluginConfig } from '@orthacms/segments-server';
import type { TransferPluginConfig } from '@orthacms/transfer-server';
import type { WebhooksPluginConfig } from '@orthacms/webhooks-server';
// orthacms:if graphql
import type { ContentGraphqlPluginConfig } from '@orthacms/content-graphql';
// orthacms:end
// orthacms:if mcp
import type { McpPluginConfig } from '@orthacms/mcp-server';
// orthacms:end
import {
    readEnv,
    readNonNegativeInt,
    readPositiveInt,
    readTrustProxy,
    requireEnv
} from '@orthacms/utils-server';

import { docsConfig } from './config/docs';
import { identityConfig, type AppIdentityConfig } from './config/identity';
import { i18nConfig } from './config/i18n';
import { mediaConfig, type AppMediaConfig } from './config/media';
import { copilotConfig, type AppCopilotConfig } from './config/copilot';
// orthacms:if mail
import { mailConfig, type AppMailConfig } from './config/mail';
// orthacms:end
import { segmentsConfig } from './config/segments';
import { transferConfig } from './config/transfer';
import { webhooksConfig } from './config/webhooks';
// orthacms:if graphql
import { contentGraphqlConfig } from './config/graphql';
// orthacms:end
// orthacms:if mcp
import { mcpConfig } from './config/mcp';
// orthacms:end

/**
 * Re-exported so `import type { AppCopilotConfig } from '../orthacms.config'`
 * keeps working. `src/plugins.ts` names these, and which file they are declared
 * in is an implementation detail of this one.
 */
export type { AppIdentityConfig, AppMediaConfig, AppCopilotConfig };
// orthacms:if mail
export type { AppMailConfig };
// orthacms:end

/** Root configuration for this app. */
export interface OrthaCmsConfig {
    port: number;
    globalPrefix: string;
    trustProxy?: TrustProxySetting;
    bodyLimit?: string | number;
    staticDir?: string;
    database: {
        url: string;
        /** Days a delivered outbox event is kept; `0` never prunes. */
        outboxRetentionDays: number;
    };
    docs: ApiDocsOptions;
    plugins: {
        identity: AppIdentityConfig;
        i18n: I18nPluginConfig;
        media: AppMediaConfig;
        copilot: AppCopilotConfig;
        // orthacms:if mail
        /**
         * Outgoing mail, or **absent** — `undefined` is the configuration of an
         * app that sends nothing, and the one it ships in. `src/plugins.ts`
         * registers the plugin only when this is present.
         */
        mail?: AppMailConfig;
        // orthacms:end
        /** Export/import — per-type identity fields and transfer ceilings. */
        transfer: TransferPluginConfig;
        /** Reader entitlements — where a reader's tags come from. */
        segments: SegmentsPluginConfig;
        /** Outgoing webhooks — delivery pacing and the URL policy. */
        webhooks: WebhooksPluginConfig;
        // orthacms:if graphql
        /** Public GraphQL endpoint — the per-operation cost budget. */
        contentGraphql: ContentGraphqlPluginConfig;
        // orthacms:end
        // orthacms:if mcp
        mcp: McpPluginConfig;
        // orthacms:end
    };
}

const config: OrthaCmsConfig = {
    port: readPositiveInt('PORT', 3000),
    globalPrefix: 'api',
    // A hop count is the recommended form and the only one a client cannot
    // forge past. Unset, forwarded headers are ignored entirely — right for an
    // app exposed directly, wrong behind any proxy.
    trustProxy: readTrustProxy(),
    bodyLimit: readEnv('MAX_REQUEST_BODY') ?? '1mb',
    // The built admin bundle, served by this same process so the API and the
    // UI share one origin — which is what identity's httpOnly, SameSite=lax
    // session cookie needs. `orthacms dev` uses Vite's proxy for the same effect.
    //
    // Relative to the app root: `orthacms start` runs from there, and this path
    // must mean the same thing whether it is read from `dist/` or from source.
    staticDir: join(process.cwd(), 'dist/admin'),
    database: {
        url: requireEnv(
            'DATABASE_URL',
            'Set it in your .env before starting the app.'
        ),
        // Delivered outbox rows only. A pending or parked event is never
        // deleted by age — a parked one is the evidence that something was
        // never recorded.
        //
        // `readNonNegativeInt` because `0` is this setting's documented
        // off-switch ("keep them forever"), and the positive reader refuses a
        // zero — which turned the documented way to disable retention into a
        // server that would not boot.
        outboxRetentionDays: readNonNegativeInt('OUTBOX_RETENTION_DAYS', 30)
    },
    docs: docsConfig(),
    plugins: {
        identity: identityConfig(),
        i18n: i18nConfig(),
        media: mediaConfig(),
        copilot: copilotConfig(),
        // orthacms:if mail
        mail: mailConfig(),
        // orthacms:end
        transfer: transferConfig(),
        segments: segmentsConfig(),
        webhooks: webhooksConfig(),
        // orthacms:if graphql
        contentGraphql: contentGraphqlConfig(),
        // orthacms:end
        // orthacms:if mcp
        mcp: mcpConfig()
        // orthacms:end
    }
};

export default config;
