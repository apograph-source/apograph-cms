import { defineMessages, useIntl } from 'react-intl';
import { Lock, PowerOff } from 'lucide-react';
import {
    Container,
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from '@orthacms/design-system';
import { useHasPermission } from '@orthacms/identity-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { useCopilotAvailable } from '../../application/useCopilotModels';
import { useRouteContext } from '../../application/useRouteContext';
import { COPILOT_USE, agentsPath } from '../../domain/agentsRoute';
import { AgentsRail } from './AgentsRail';
import { AgentsThread } from './AgentsThread';
import { AgentsTopBar } from './AgentsTopBar';
import { useDocumentTitle } from '@orthacms/utils-admin';

const messages = defineMessages({
    heading: {
        id: 'copilot.agents.heading',
        defaultMessage: 'Ortha AI'
    },
    forbiddenTitle: {
        id: 'copilot.agents.forbiddenTitle',
        defaultMessage: 'No access'
    },
    forbiddenBody: {
        id: 'copilot.agents.forbiddenBody',
        defaultMessage: 'You don’t have permission to use Ortha AI here.'
    },
    offTitle: {
        id: 'copilot.agents.offTitle',
        defaultMessage: 'Ortha AI is turned off'
    },
    offBody: {
        id: 'copilot.agents.offBody',
        defaultMessage:
            'This deployment doesn’t run Ortha AI. An administrator can turn it on.'
    }
});

/**
 * The **Agents view** — the copilot as a place you go, mounted inside the
 * workspace shell at `/workspaces/:id/agents`.
 *
 * The docked panel and this page are two shapes of the same thing, and both
 * earn their keep:
 *
 * - the **panel** is for a question *about the page you are on*. It is
 *   non-modal so you can act on the answer without closing it, and several can
 *   run at once behind the dock.
 * - the **page** is for the work where the conversation *is* the task —
 *   a long thread, a change you want to read carefully, or picking up something
 *   you asked yesterday. History is a column rather than a dropdown, and the
 *   transcript gets the width to render a table or a diff.
 *
 * Three columns, and the third one is the point: the app sidebar keeps the
 * workspace's CMS navigation on screen, so leaving the Agents view is one click
 * on something already visible rather than a trip back through a menu. The
 * sidebar's own `ViewSwitcher` is the two-way control between the modes.
 *
 * The permission check mirrors the server's gate rather than replacing it — the
 * run route enforces `copilot:use` regardless, and `useHasPermission` is
 * fail-closed, so a user whose permissions have not loaded sees the empty state
 * rather than a composer that 403s on Enter.
 */
export function AgentsPage() {
    const intl = useIntl();
    // Names this route in the tab strip, the window list, the history
    // and a screen reader's window announcement. Every private route but
    // Workspaces was still titled a bare "Admin" (WCAG 2.4.2, `ORT-140`).
    useDocumentTitle(intl.formatMessage(messages.heading));
    const workspace = useCurrentWorkspace();
    const canUse = useHasPermission(COPILOT_USE);
    // Reached only by a bookmark or a typed URL once the operator has turned
    // the copilot off — the switcher and the launcher that lead here are both
    // gone by then. Worth a branch anyway: the alternative is a page whose
    // every query 404s, which reads as broken rather than as switched off.
    const deploymentRunsCopilot = useCopilotAvailable({ enabled: canUse });
    const routeContext = useRouteContext();

    // The page's `<h1>`, visually hidden. This route renders no
    // `ContainerHeader`, by design — the transcript is the page and a title bar
    // over it would cost the width it needs — so the first heading a screen
    // reader met was the rail's date buckets: pressing `H` suggested the page
    // was *about* dates and pressing `1` found nothing (`ORT-117`, `ORT-167`).
    // Rendered in both branches, because the permission-denied state is a full
    // page too.
    const heading = (
        <h1 className="sr-only">{intl.formatMessage(messages.heading)}</h1>
    );

    if (!canUse || !deploymentRunsCopilot) {
        // Two reasons, one shape. They are told apart deliberately rather than
        // collapsed into "no access": "you may not" and "nobody may here" send
        // the user to different people.
        const denied = !canUse;
        return (
            <Container className="py-8">
                {heading}
                <Empty className="border" role="alert">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            {denied ? <Lock /> : <PowerOff />}
                        </EmptyMedia>
                        <EmptyTitle>
                            {intl.formatMessage(
                                denied
                                    ? messages.forbiddenTitle
                                    : messages.offTitle
                            )}
                        </EmptyTitle>
                        <EmptyDescription>
                            {intl.formatMessage(
                                denied
                                    ? messages.forbiddenBody
                                    : messages.offBody
                            )}
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            </Container>
        );
    }

    return (
        <>
            {heading}
            {/* Hoists itself into the inset's fixed bar strip, so it spans the
                rail and the thread both and neither of them scrolls under it. */}
            <AgentsTopBar
                workspaceId={workspace.id}
                basePath={agentsPath(workspace.id)}
            />
            {/* `min-h-0` against the shell's bounded column: the rail and the
                transcript each run their own inner scroll, and without it both
                would grow the page instead. */}
            <div className="flex min-h-0 min-w-0 flex-1">
                <AgentsRail workspaceId={workspace.id} />
                <AgentsThread
                    workspaceId={workspace.id}
                    workspaceName={workspace.name}
                    routeContext={routeContext}
                />
            </div>
        </>
    );
}
