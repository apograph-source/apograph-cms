import { defineMessages, useIntl } from 'react-intl';
import { PanelRightOpen } from 'lucide-react';
import { Button, TopBarActions } from '@orthacms/design-system';
import {
    RIGHT_PANEL_ID,
    usePageChromeHosts,
    usePanelFocusHandoff,
    useRightPanel
} from '../../utils/pageChrome';

const messages = defineMessages({
    show: {
        id: 'shell.rightPanel.show',
        defaultMessage: 'Show {title}'
    }
});

/**
 * The **trailing region of a page's top bar**: whatever the open page put there
 * through `PageActionsPortal` (the entry editor's Publish + ⋯), plus — when a
 * right panel is registered but collapsed — the button that brings it back.
 *
 * Render it as the **last** child of a `TopBar`. `PageTopBar` already does; a
 * bar that composes `TopBar` itself (content-admin's `ContentTopBar`) adds it the
 * same way, which is the whole reason this is a component rather than something
 * baked into `TopBar` — the design system can't reach the shell's context.
 *
 * The host stays mounted whether or not anything fills it, so a page's actions
 * can portal in the moment they mount.
 */
export function PageActions() {
    const intl = useIntl();
    const { setActionsHost } = usePageChromeHosts();
    const panel = useRightPanel();
    const showExpand = !!panel?.present && !panel.open;
    // Collapsing the panel destroys the button that did it (it goes `inert` with
    // the rest of the column), so this one — the only way back — takes the focus.
    const expandRef = usePanelFocusHandoff('bar');

    return (
        <TopBarActions>
            <div ref={setActionsHost} className="flex items-center gap-2" />
            {showExpand ? (
                <Button
                    ref={expandRef}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="-mr-1 size-7 shrink-0 text-muted-foreground"
                    aria-controls={RIGHT_PANEL_ID}
                    aria-expanded={false}
                    aria-label={intl.formatMessage(messages.show, {
                        title: panel.title
                    })}
                    onClick={panel.toggle}
                >
                    <PanelRightOpen aria-hidden />
                </Button>
            ) : null}
        </TopBarActions>
    );
}
