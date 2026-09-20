import type { AdminPlugin } from '@orthacms/bootstrap-admin';
import { ActivityPlugin } from '@orthacms/activity-admin';
import { ApiTokensPlugin } from '@orthacms/api-tokens-admin';
import { WebhooksPlugin } from '@orthacms/webhooks-admin';
import { ContentPlugin } from '@orthacms/content-admin';
import { I18nPlugin } from '@orthacms/i18n-admin';
import { IdentityPlugin } from '@orthacms/identity-admin';
import { InsightsPlugin } from '@orthacms/insights-admin';
import { MediaPlugin } from '@orthacms/media-admin';
import { ShellPlugin } from '@orthacms/shell-admin';
import { UsersPlugin } from '@orthacms/users-admin';
import { WorkspacesPlugin } from '@orthacms/workspaces-admin';
import { WysiwygPlugin } from '@orthacms/wysiwyg-admin';
import { CopilotPlugin } from '@orthacms/copilot-admin';
import { AlarmsPlugin } from '@orthacms/alarms-admin';
import { transferAdminPlugin } from '@orthacms/transfer-admin';
import { SegmentsPlugin } from '@orthacms/segments-admin';
import { ProtectionPlugin } from '@orthacms/protection-admin';

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
