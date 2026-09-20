import type { AdminPlugin } from '@orthacms/bootstrap-admin';
import { IdentityPlugin } from '@orthacms/identity-admin';
import { ShellPlugin } from '@orthacms/shell-admin';
import { WorkspacesPlugin } from '@orthacms/workspaces-admin';
import { ContentPlugin } from '@orthacms/content-admin';
import { I18nPlugin } from '@orthacms/i18n-admin';
import { WysiwygPlugin } from '@orthacms/wysiwyg-admin';
import { MediaPlugin } from '@orthacms/media-admin';
import { InsightsPlugin } from '@orthacms/insights-admin';
import { UsersPlugin } from '@orthacms/users-admin';
import { ActivityPlugin } from '@orthacms/activity-admin';
import { ApiTokensPlugin } from '@orthacms/api-tokens-admin';
import { WebhooksPlugin } from '@orthacms/webhooks-admin';
import { CopilotPlugin } from '@orthacms/copilot-admin';
import { transferAdminPlugin } from '@orthacms/transfer-admin';
import { AlarmsPlugin } from '@orthacms/alarms-admin';
import { SegmentsPlugin } from '@orthacms/segments-admin';
import { ProtectionPlugin } from '@orthacms/protection-admin';

/**
 * Builds the admin's plugin list — the app's whole composition, mirroring
 * `apps/server/src/plugins.ts` on the API side.
 *
 * A function in its own module rather than an array literal inside the
 * `createAdmin` call, because the one property of this list that is genuinely
 * dangerous cannot be asserted from a browser: **which plugin's `layout` the
 * host mounts.** `createAdmin` takes the first `layout` it finds
 * (`plugins.map(p => p.layout).find(Boolean)`), the shell's layout is what
 * composes identity's `RequireAuth`, and a layout registered ahead of the
 * shell's would therefore render every private route **ungated** — with the
 * sidebar, the skip link and the `<main>` landmark gone with it, which is what
 * makes it look like a styling accident rather than an authorization one. The
 * host now warns when two plugins contribute a layout; `plugins.spec.ts` asserts
 * that in this app exactly one does, and that it is the shell.
 *
 * **What the order does and does not decide.** Slot registration is *not*
 * order-sensitive: slots are module-level singletons and `createAdmin` registers
 * every plugin's contributions before the first render, so a filler registered
 * ahead of the plugin that defines its slot still lands. Only two things follow
 * from position — the order of items *within* a slot (`byOrder`, then
 * registration order), and which plugin wins an id collision in a merge that
 * takes the last writer, which is why Insights goes first among the interior
 * features.
 */
export function buildPlugins(): AdminPlugin[] {
    return [
        // First, and the only plugin contributing public routes: the sign-in and
        // accept-invite screens, which must render outside the gated layout.
        IdentityPlugin(),
        // The one `layout` contributor — the app chrome, wrapping every
        // non-public route in identity's auth gate. Anything contributing a
        // layout ahead of this would silently replace it (see above).
        ShellPlugin(),
        WorkspacesPlugin(),
        // Insights goes first among the workspace-interior features: it
        // registers the dashboard's default sections, and section
        // contributions merge by id with the LAST one winning — so a plugin
        // that renames or reorders a band has to come after this. Its widget
        // slot is order-independent, so nothing else here is affected.
        InsightsPlugin(),
        // Workspace-interior features. They contribute to the workspace shell's
        // rail/route slots; reading them after WorkspacesPlugin() is intent, not
        // a requirement — the slots are module singletons.
        ContentPlugin(),
        // Fills the Content Library's extension slots, so it reads after
        // ContentPlugin().
        I18nPlugin(),
        // Also a Content Library slot filler — it owns the control every
        // `richtext` field renders — so it likewise reads after ContentPlugin().
        WysiwygPlugin(),
        MediaPlugin(),
        // Export/import. Another Content Library slot filler — the entry menu,
        // the records selection bar and the collection toolbar — so it reads
        // after ContentPlugin() for the same reason I18nPlugin() does.
        transferAdminPlugin(),
        // Content alarms. Another Content Library slot filler — the entry
        // rail's checks block, an optional records column, and the toolbar's
        // "Save as rule" — so it reads after ContentPlugin() for the same
        // reason the two above it do. It also contributes its own workspace
        // route and nav entry: alarms are per-workspace content rules, not a
        // global page.
        AlarmsPlugin(),
        // The docked chat panel plus the full-page Agents view. Belongs with the
        // workspace-interior features: the panel mounts into the workspace
        // shell's sidebar footer.
        CopilotPlugin(),
        // Reader entitlements. It fills the Content Library's entry-header and
        // entry-tab slots, so like the other library fillers it reads after
        // ContentPlugin(); its own directory page is independent of that order.
        SegmentsPlugin(),
        // Publication protection. Three contributions into the Content
        // Library's entry editor — the header chip, the rail's Review block and
        // the publish verdict — so it reads after ContentPlugin() like every
        // other library filler. It owns no page of its own.
        ProtectionPlugin(),
        UsersPlugin(),
        ActivityPlugin(),
        // Global token-management page in the main sidebar (no workspace
        // context); backs the external content API.
        ApiTokensPlugin(),
        // Outgoing webhooks (directory group, beside API tokens): the other
        // integration surface, and global for the same reason — an endpoint is
        // not scoped to a workspace.
        WebhooksPlugin()
    ];
}
