import { useEffect } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { Layers, Sparkles } from 'lucide-react';
import {
    SegmentedControl,
    SegmentedControlItem,
    SidebarGroup
} from '@apograph/design-system';
import { useHasPermission } from '@apograph/identity-admin';
import { useCopilotAvailable } from '../../application/useCopilotModels';
import {
    COPILOT_USE,
    agentsPath,
    isAgentsPath
} from '../../domain/agentsRoute';

// The product is **Apograph AI**; the code keeps `copilot`. See the naming note in
// `docs/design/copilot.md`.
const messages = defineMessages({
    label: {
        id: 'copilot.viewSwitcher.label',
        defaultMessage: 'View'
    },
    cms: {
        id: 'copilot.viewSwitcher.cms',
        defaultMessage: 'CMS'
    },
    agents: {
        id: 'copilot.viewSwitcher.agents',
        defaultMessage: 'Agents'
    }
});

/** The two modes, as the control's values. */
const CMS = 'cms';
const AGENTS = 'agents';

/** Where the CMS half of the switcher goes back to, per workspace. */
const returnKey = (workspaceId: string) =>
    `apograph:agents:return:${workspaceId}`;

/**
 * Records the CMS page the user was last on.
 *
 * `sessionStorage` rather than component state: the switcher unmounts and
 * remounts as the sidebar's contextual region is rebuilt, and a per-tab memory
 * is also the honest lifetime for "where I was" — it should not follow someone
 * into next week's session. Storage can throw (a browser with site data
 * disabled, Safari's private mode historically), and the switcher still works
 * without it — it just lands on the workspace base.
 */
function rememberCmsPath(workspaceId: string, path: string): void {
    try {
        sessionStorage.setItem(returnKey(workspaceId), path);
    } catch {
        // Not being able to remember is not worth an error to the user.
    }
}

/** The remembered CMS page, or `null`. */
function readCmsPath(workspaceId: string): string | null {
    try {
        return sessionStorage.getItem(returnKey(workspaceId));
    } catch {
        return null;
    }
}

/**
 * The two-way switch between the CMS and the Agents view, at the top of the
 * workspace sidebar.
 *
 * **It is the answer to "how do I get back?"** The Agents view is a full page,
 * and a full page reached from a nav row is a place people get stuck: the way
 * out is wherever they happen to remember. A segmented control that is on screen
 * in *both* modes says there are two of them and which one you are in, and
 * costs one click either way.
 *
 * Going back to the CMS returns you to **the page you left**, not to the
 * workspace's default section. Someone who breaks off mid-way through an entry
 * to ask a question should not have to navigate back to it, and the round trip
 * is the whole reason both surfaces exist.
 *
 * It renders in the sidebar's contextual region — **above**
 * `CurrentWorkspaceProvider`, like every other section there — so it resolves the
 * open workspace from the route rather than from context. Nothing renders
 * outside a workspace, without `copilot:use`, or on a deployment that turned
 * the copilot off.
 */
export function ViewSwitcher() {
    const intl = useIntl();
    const match = useMatch('/workspaces/:id/*');
    const workspaceId = match?.params.id;
    const canUse = useHasPermission(COPILOT_USE);
    // A deployment that turned the copilot off registers no copilot route, so
    // the Agents half of this control would switch to a page with nothing
    // behind it. Same probe the launcher uses, off the same cached query.
    const deploymentRunsCopilot = useCopilotAvailable({ enabled: canUse });
    const location = useLocation();
    const navigate = useNavigate();

    const inAgents = isAgentsPath(location.pathname);
    const here = `${location.pathname}${location.search}`;

    useEffect(() => {
        if (!workspaceId || inAgents) {
            return;
        }
        rememberCmsPath(workspaceId, here);
    }, [workspaceId, inAgents, here]);

    if (!workspaceId || !canUse || !deploymentRunsCopilot) {
        return null;
    }

    const change = (value: string) => {
        // Radix clears the value when the selected item is clicked again. That
        // is a deselect, not a switch — there is no third state to land in.
        if (!value || value === (inAgents ? AGENTS : CMS)) {
            return;
        }
        navigate(
            value === AGENTS
                ? agentsPath(workspaceId)
                : (readCmsPath(workspaceId) ?? `/workspaces/${workspaceId}`)
        );
    };

    return (
        <SidebarGroup className="pb-0">
            <SegmentedControl
                value={inAgents ? AGENTS : CMS}
                onValueChange={change}
                aria-label={intl.formatMessage(messages.label)}
                // The sidebar paints a dark surface in both themes, so the
                // control states its own colours rather than inheriting the
                // page palette the design-system default assumes.
                //
                // The inactive segment used to be `text-sidebar-foreground/70`
                // over this `/40` surface. A semi-transparent foreground over a
                // semi-transparent background is exactly the pair axe reports as
                // `incomplete` rather than deciding — so it was discarded, and
                // the suite stayed green over a tint the package's own
                // `AGENTS.md` forbids in as many words: use the full token, "not
                // an opacity of it … the token is the one that was verified
                // against AA, so tinting it further is undoing that check by
                // hand" (`ORT-117`). The full token is used now. Nothing is lost
                // from the selected state, which was never carried by the
                // contrast between the two: `SegmentedControlItem` pairs its
                // selected fill with `font-semibold`, so the distinction is
                // weight plus background, and holds under 1.4.1 without colour.
                className="border-sidebar-border bg-sidebar-accent/40 flex w-full rounded-lg p-0.5"
            >
                <SegmentedControlItem
                    value={CMS}
                    className="text-sidebar-foreground hover:text-sidebar-foreground data-[state=on]:bg-sidebar-accent data-[state=on]:text-sidebar-foreground flex-1 justify-center px-2"
                >
                    <Layers className="size-3.5" aria-hidden />
                    {intl.formatMessage(messages.cms)}
                </SegmentedControlItem>
                <SegmentedControlItem
                    value={AGENTS}
                    className="text-sidebar-foreground hover:text-sidebar-foreground data-[state=on]:bg-sidebar-accent data-[state=on]:text-sidebar-foreground flex-1 justify-center px-2"
                >
                    <Sparkles className="size-3.5" aria-hidden />
                    {intl.formatMessage(messages.agents)}
                </SegmentedControlItem>
            </SegmentedControl>
        </SidebarGroup>
    );
}
