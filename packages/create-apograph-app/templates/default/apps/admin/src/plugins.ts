import type { AdminPlugin } from '@apograph/bootstrap-admin';
import { ActivityPlugin } from '@apograph/activity-admin';
import { ApiTokensPlugin } from '@apograph/api-tokens-admin';
import { WebhooksPlugin } from '@apograph/webhooks-admin';
import { ContentPlugin } from '@apograph/content-admin';
import { I18nPlugin } from '@apograph/i18n-admin';
import { IdentityPlugin } from '@apograph/identity-admin';
import { InsightsPlugin } from '@apograph/insights-admin';
import { MediaPlugin } from '@apograph/media-admin';
import { ShellPlugin } from '@apograph/shell-admin';
import { UsersPlugin } from '@apograph/users-admin';
import { WorkspacesPlugin } from '@apograph/workspaces-admin';
import { WysiwygPlugin } from '@apograph/wysiwyg-admin';
import { CopilotPlugin } from '@apograph/copilot-admin';
import { AlarmsPlugin } from '@apograph/alarms-admin';
import { transferAdminPlugin } from '@apograph/transfer-admin';
import { SegmentsPlugin } from '@apograph/segments-admin';
import { ProtectionPlugin } from '@apograph/protection-admin';

/**
 * The admin's composition, mirroring `apps/server/src/plugins.ts` on the UI
 * side.
 *
 * **Two positions matter; the rest is legibility.**
 *
 * `IdentityPlugin` is first because it contributes the only *public* routes —
 * sign-in and accept-invite — which must render outside the gated layout.
 *
 * `ShellPlugin` is the one plugin contributing a `layout`, and the host mounts
 * the **first** layout it finds. The shell's layout is what composes
 * identity's auth gate, so a plugin registering a layout ahead of it would
 * render every private route *ungated* — losing the sidebar and the `<main>`
 * landmark with it, which makes an authorization bug look like a styling
 * accident. Keep it second.
 *
 * Everything else is order-independent: slots are module-level singletons and
 * every plugin's contributions are registered before the first render, so a
 * filler registered ahead of the plugin defining its slot still lands. Only
 * two things follow from position — the order of items within a slot, and
 * which plugin wins an id collision in a last-writer-wins merge.
 */
export function buildPlugins(): AdminPlugin[] {
    return [
        IdentityPlugin(),
        ShellPlugin(),
        WorkspacesPlugin(),
        // Registers the dashboard's default sections, which merge by id with
        // the last writer winning — so anything renaming a band comes after.
        InsightsPlugin(),
        ContentPlugin(),
        // Content Library slot fillers, hence after ContentPlugin().
        I18nPlugin(),
        WysiwygPlugin(),
        MediaPlugin(),
        // Export/import. Another Content Library slot filler — the entry menu,
        // the records selection bar and the collection toolbar — so it reads
        // after ContentPlugin() for the same reason I18nPlugin() does.
        transferAdminPlugin(),
        // Another Content Library slot filler — the entry rail's checks block,
        // an optional records column, and "Save as rule" in the toolbar.
        AlarmsPlugin(),
        // The docked chat panel plus the full-page Agents view. Belongs with
        // the workspace-interior features: the panel mounts into the workspace
        // shell's sidebar footer.
        CopilotPlugin(),
        // Reader entitlements — who may *read* published content. It fills the
        // Content Library's entry-header and entry-tab slots, so like the other
        // library fillers it reads after ContentPlugin(); its own audience
        // directory is independent of that order. Inert until an audience
        // exists.
        SegmentsPlugin(),
        // Publication protection: the entry editor's review chip, rail
        // block and publish verdict. A Content Library slot filler, so it
        // reads after ContentPlugin() like the others.
        ProtectionPlugin(),
        UsersPlugin(),
        ActivityPlugin(),
        ApiTokensPlugin(),
        WebhooksPlugin()
    ];
}
