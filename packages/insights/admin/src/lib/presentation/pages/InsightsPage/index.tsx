import { defineMessages, useIntl } from 'react-intl';
import { BarChart3 } from 'lucide-react';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbList,
    BreadcrumbPage,
    Container,
    TopBar,
    TopBarActions,
    TopBarIcon
} from '@orthacms/design-system';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { InsightsRangeProvider } from '../../../hooks/useInsightsRange';
import { useInsightsLayout } from '../../../hooks/useInsightsLayout';
import { InsightsRangePicker } from '../../components/InsightsRangePicker';
import { InsightsSectionBand } from '../../components/InsightsSectionBand';
import { useDocumentTitle } from '@orthacms/utils-admin';

/** Intl descriptors for the insights page, co-located here. */
const messages = defineMessages({
    title: {
        id: 'insights.page.title',
        defaultMessage: 'Insights'
    },
    subtitle: {
        id: 'insights.page.subtitle',
        defaultMessage: "What changed in {workspace}, and what's gone quiet."
    },
    empty: {
        id: 'insights.page.empty',
        defaultMessage:
            'No insights are available yet. Widgets appear here as the plugins that own the data are installed.'
    }
});

/**
 * The Insights page, mounted inside the workspace shell at
 * `/workspaces/:id/insights`.
 *
 * It owns the **frame and nothing else** — the top bar, the heading, the range
 * picker, the section bands and the per-widget error boundary. It contributes no
 * widgets of its own and imports no other feature package: every card comes
 * through `INSIGHTS_WIDGET_SLOT` from the plugin that owns the data behind it.
 * That is what keeps a dashboard from slowly becoming the one module that has to
 * know about every other one.
 */
export function InsightsPage() {
    const intl = useIntl();
    // Names this route in the tab strip, the window list, the history
    // and a screen reader's window announcement. Every private route but
    // Workspaces was still titled a bare "Admin" (WCAG 2.4.2, `ORT-140`).
    useDocumentTitle(intl.formatMessage(messages.title));
    const workspace = useCurrentWorkspace();
    const bands = useInsightsLayout();

    return (
        <InsightsRangeProvider>
            <TopBar>
                <TopBarIcon className="bg-warning-soft text-warning-soft-foreground">
                    <BarChart3 />
                </TopBarIcon>
                <Breadcrumb>
                    <BreadcrumbList className="font-medium">
                        <BreadcrumbItem>
                            <BreadcrumbPage className="font-medium">
                                {intl.formatMessage(messages.title)}
                            </BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>
                <TopBarActions>
                    <InsightsRangePicker />
                </TopBarActions>
            </TopBar>

            <Container className="flex flex-col gap-6 py-8">
                <header className="flex flex-col gap-1">
                    <h1 className="text-2xl font-semibold tracking-[-0.01em]">
                        {intl.formatMessage(messages.title)}
                    </h1>
                    <p className="text-muted-foreground">
                        {intl.formatMessage(messages.subtitle, {
                            workspace: workspace.name
                        })}
                    </p>
                </header>

                {bands.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        {intl.formatMessage(messages.empty)}
                    </p>
                ) : (
                    bands.map((band) => (
                        <InsightsSectionBand
                            key={band.section.id}
                            band={band}
                        />
                    ))
                )}
            </Container>
        </InsightsRangeProvider>
    );
}
