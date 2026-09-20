import { Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@orthacms/identity-server';
import {
    InjectContentRegistry,
    WorkspaceGrantsQuery,
    type ContentTypeRegistry
} from '@orthacms/content-server';
import { ToolRegistry } from '@orthacms/tools-server';
import type { ToolDefinition, ToolProvider } from '@orthacms/tools-server';
import { LocaleRegistryService } from '../locales/services/locale-registry.service';
import { LocaleGroupService } from '../content/services/locale-group.service';

/**
 * The i18n plugin's read tools — `i18n_locales_list` and
 * `i18n_translations_get`.
 *
 * **The two land on different surfaces, which is worth reading before adding a
 * third here.** `i18n_locales_list` is offered to MCP as well as the copilot:
 * it returns deployment configuration, identical for every caller, with no
 * publish state to leak. `i18n_translations_get` stays copilot-only because
 * `LocaleGroupService.entryLocales` scopes to workspace and soft-delete but
 * **not** publish state, so it reports a draft sibling and its status — which
 * an MCP `read` token must not see (the endpoint's own `content_translations`
 * is published-only). Same folder, same plugin, opposite answers; the deciding
 * question is always what the tool would show a token holding `content:read`.
 *
 * **`listLocales` is what makes `admin_content_search`'s `locale` usable.**
 * The configured locale slugs are deployment config, not content, so nothing
 * else tells the model they exist: without this it either omits `locale` and
 * silently searches the default, or guesses a slug and gets a tool error. One
 * cheap call replaces both failure modes.
 *
 * `getTranslations` answers the question a localized CMS is actually asked —
 * "which languages is this in, and which is missing?" — from the same
 * `LocaleGroupService` the admin's locale panel reads, so the answer can't
 * drift from what the editor shows.
 */
@Injectable()
export class I18nCopilotToolProvider implements ToolProvider, OnModuleInit {
    constructor(
        private readonly locales: LocaleRegistryService,
        private readonly groups: LocaleGroupService,
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly grants: WorkspaceGrantsQuery,
        @Optional() private readonly toolRegistry?: ToolRegistry
    ) {}

    /**
     * Register with the shared tool registry once the DI graph is built —
     * the same catalogue the MCP endpoint serves, narrowed to the `copilot`
     * surface by each tool's `surfaces`. `@Optional()` because a deployment
     * may run neither consumer, in which case these simply go unregistered.
     */
    onModuleInit(): void {
        this.toolRegistry?.register(this);
    }

    /** The two locale tools, in the order the model sees them. */
    tools(): readonly ToolDefinition[] {
        return [this.listLocales(), this.getTranslations()];
    }

    /** `i18n_locales_list` — the deployment's configured locales. */
    private listLocales(): ToolDefinition {
        return {
            name: 'i18n_locales_list',
            title: 'List locales',
            description:
                'List the locales this CMS is configured for, with their slugs and which one ' +
                'is the default. Call this before passing a `locale` to admin_content_search ' +
                '— locale slugs are deployment configuration and are not in your system ' +
                'prompt, so guessing one produces an error and omitting one silently searches ' +
                'the default language.',
            inputSchema: {
                type: 'object',
                properties: {},
                additionalProperties: false
            },
            // Locales are deployment configuration carrying no workspace data,
            // and the HTTP route needs only a session. `content:read` is the
            // narrowest key that means "may look at content at all", which is
            // the only thing this list is useful for.
            requires: [PERMISSIONS.CONTENT_READ],
            readOnly: true,
            effect: 'read',
            // No `surfaces` — offered to both. The tension that splits every
            // other content tool is about *visibility of drafts* and *who a
            // write is attributed to*, and a locale list has neither: it
            // returns the same deployment configuration to every caller, holds
            // no workspace data, and writes nothing. An MCP client needs it for
            // exactly the reason the copilot does — `?locale=` on the public
            // reads takes a slug that appears in no schema and no prompt.
            handler: async () => ({ locales: this.locales.all() })
        };
    }

    /** `i18n_translations_get` — which locales an entry exists in. */
    private getTranslations(): ToolDefinition {
        return {
            name: 'i18n_translations_get',
            title: 'An entry’s translations',
            description:
                'For one entry of a localized type, list every configured locale and whether ' +
                'the entry has been translated into it — with each translation’s own entry id ' +
                'and publish state. Use it to answer “what is missing a German version?” or to ' +
                'get the id of a sibling translation before reading it.',
            inputSchema: {
                type: 'object',
                properties: {
                    typeName: {
                        type: 'string',
                        description:
                            'The content type. It must be localized; a non-localized type is an error.'
                    },
                    id: {
                        type: 'string',
                        description:
                            'The id of any one locale’s row, as returned by admin_content_search.'
                    }
                },
                required: ['typeName', 'id'],
                additionalProperties: false
            },
            requires: [PERMISSIONS.CONTENT_READ],
            readOnly: true,
            effect: 'read',
            surfaces: ['copilot'],
            handler: async (input, ctx) => {
                const args = (input ?? {}) as { typeName: string; id: string };

                // The same grant re-check every content tool makes, for the
                // same reason: `WorkspaceGuard` proved membership, not that
                // this workspace may reach this type, and the name came from
                // the model. `resolveI18nType` (the HTTP path) deliberately
                // does not check grants — its callers are already behind a
                // workspace-scoped controller reached from the admin's own UI.
                const type = this.registry.get(args.typeName);
                const granted = await this.grants.grantedSlugs(ctx.workspaceId);
                if (!type || !granted.has(type.name)) {
                    throw new Error(
                        `Unknown content type "${args.typeName}" in this workspace.`
                    );
                }
                // "Not localized" is a different fact from "no such type" and
                // is safe to say: it describes the type the caller already
                // proved it can reach. Answering `[]` would read as "this has
                // no other languages" when the truth is "this content is not
                // translated at all" — the same distinction the public API
                // draws by 400-ing `?translations=preview` on a plain type.
                if (!type.i18n) {
                    throw new Error(
                        `Content type "${type.name}" is not localized, so it has no translations.`
                    );
                }

                return this.groups.entryLocales(type, args.id, ctx.workspaceId);
            }
        };
    }
}
