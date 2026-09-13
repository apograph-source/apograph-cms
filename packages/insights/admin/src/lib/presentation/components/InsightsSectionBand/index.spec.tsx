import { useState, type ComponentType } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { InsightsSectionBand } from './index';
import {
    InsightsRangeProvider,
    useInsightsRange
} from '../../../hooks/useInsightsRange';
import type { InsightsBand } from '../../../utils/resolveInsightsLayout';
import type {
    InsightsWidget,
    InsightsWidgetSize
} from '../../slots/insightsSlots';

/**
 * The band is where a contributed component is actually mounted, so it is the
 * only place two of this package's central claims are observable: that one
 * widget's render-phase throw is contained, and that the width a widget asks
 * for is resolved defensively.
 *
 * Neither is reachable from `admin-e2e`. Its seed shapes HTTP responses, and a
 * failing response takes `WidgetCard`'s error branch — a different code path
 * that never reaches the boundary. Making a *component* throw means supplying
 * the component, which is what a slot item is and what this file does.
 */

const widget = (
    over: Partial<InsightsWidget> & { id: string }
): InsightsWidget => ({
    section: 'content',
    titleId: `insights.test.${over.id}`,
    defaultTitle: over.id,
    Component: (() => <span>{over.id} body</span>) as ComponentType,
    ...over
});

const band = (widgets: InsightsWidget[]): InsightsBand => ({
    section: {
        id: 'content',
        titleId: 'insights.section.content',
        defaultTitle: 'Content'
    },
    widgets
});

/**
 * Renders one band under a real range provider, plus a control that changes the
 * window — the page's own recovery affordance, and the thing `resetKey` is fed
 * from.
 */
function Harness({ widgets }: { widgets: InsightsWidget[] }) {
    return (
        <IntlProvider locale="en">
            <MemoryRouter initialEntries={['/insights']}>
                <InsightsRangeProvider>
                    <RangeButton />
                    <InsightsSectionBand band={band(widgets)} />
                </InsightsRangeProvider>
            </MemoryRouter>
        </IntlProvider>
    );
}

function RangeButton() {
    const { setRange } = useInsightsRange();
    return (
        <button type="button" onClick={() => setRange('90d')}>
            to 90d
        </button>
    );
}

describe('InsightsSectionBand widget isolation', () => {
    let logged: unknown[][];
    let consoleError: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        logged = [];
        // React reports a caught render error on `console.error` as well as the
        // boundary's own log, so the spy both silences the noise and gives the
        // boundary's message something to be asserted against.
        consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation((...args: unknown[]) => {
                logged.push(args);
            });
    });

    afterEach(() => {
        consoleError.mockRestore();
    });

    it('keeps the neighbours mounted when one widget throws [insights:I-13]', () => {
        const Boom = (() => {
            throw new Error('mapper hit an unexpected null');
        }) as ComponentType;

        render(
            <Harness
                widgets={[
                    widget({ id: 'healthy-before' }),
                    widget({
                        id: 'broken',
                        defaultTitle: 'Gone quiet',
                        Component: Boom
                    }),
                    widget({ id: 'healthy-after' })
                ]}
            />
        );

        // The two neighbours are the point: a throw inside a component with no
        // boundary of its own unmounts the whole tree React was rendering, so
        // dropping the per-widget WidgetBoundary leaves an empty page here.
        expect(screen.getByText('healthy-before body')).toBeTruthy();
        expect(screen.getByText('healthy-after body')).toBeTruthy();

        // And the failure is attributed rather than anonymous. Its placeholder
        // heading is an h3, like a working card's — the one card level the
        // outline test in `admin-e2e` cannot reach, since nothing there throws.
        // covers: insights:I-24
        expect(
            screen.getByRole('heading', { level: 3, name: 'Gone quiet' })
        ).toBeTruthy();
        expect(screen.getByRole('alert').textContent).toContain(
            'This widget stopped working'
        );
        expect(
            logged.some(
                (args) =>
                    typeof args[0] === 'string' &&
                    args[0].includes(
                        '[insights] widget "Gone quiet" failed to render'
                    )
            )
        ).toBe(true);
    });

    it('clears a recorded failure when the range changes [insights:I-14]', () => {
        // Throws on one window's data and is fine on the next — a mapper that
        // trips over a shape only the 30-day aggregate produces, which is the
        // case `resetKey` exists for. Keyed on the range rather than on a call
        // counter so a re-render of the same window throws the same way React
        // saw the first time.
        const FlakyByRange = (() => {
            const { range } = useInsightsRange();
            if (range === '30d') throw new Error('bad data for this window');
            return <span>recovered body</span>;
        }) as ComponentType;

        render(
            <Harness
                widgets={[
                    widget({
                        id: 'flaky',
                        defaultTitle: 'Uploads',
                        Component: FlakyByRange
                    })
                ]}
            />
        );

        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.queryByText('recovered body')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'to 90d' }));

        // Without `resetKey={range}` the boundary holds `failed: true` for the
        // life of the page and this card stays broken until a full reload.
        expect(screen.getByText('recovered body')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('does not reset a failure on an unrelated re-render [insights:I-14]', () => {
        const Boom = (() => {
            throw new Error('always broken');
        }) as ComponentType;

        function Rerenderer() {
            const [tick, setTick] = useState(0);
            return (
                <IntlProvider locale="en">
                    <MemoryRouter initialEntries={['/insights']}>
                        <InsightsRangeProvider>
                            <button
                                type="button"
                                onClick={() => setTick(tick + 1)}
                            >
                                re-render
                            </button>
                            <InsightsSectionBand
                                band={band([
                                    widget({
                                        id: 'broken',
                                        defaultTitle: 'Uploads',
                                        Component: Boom
                                    })
                                ])}
                            />
                        </InsightsRangeProvider>
                    </MemoryRouter>
                </IntlProvider>
            );
        }

        render(<Rerenderer />);
        expect(screen.getByRole('alert')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 're-render' }));

        // The reset is keyed on the range, not on identity: a boundary that
        // dropped its failure whenever props were recreated would remount a
        // genuinely broken widget on every parent render, throwing in a loop.
        expect(screen.getByRole('alert')).toBeTruthy();
    });
});

describe('InsightsSectionBand widget width', () => {
    const wrapperClass = (id: string) =>
        screen.getByTestId('band').querySelector(`[data-widget-id="${id}"]`)
            ?.className ?? '';

    function renderSizes(sizes: Record<string, string | undefined>) {
        render(
            <div data-testid="band">
                <Harness
                    widgets={Object.entries(sizes).map(([id, size]) =>
                        widget({
                            id,
                            // A contributed widget is written in another package
                            // and need not be compiling against this union —
                            // which is exactly the case the guard is for.
                            size: size as InsightsWidgetSize | undefined
                        })
                    )}
                />
            </div>
        );
    }

    it('gives a declared size its own span [insights:I-20]', () => {
        renderSizes({ tile: 'xs', wide: 'full' });

        // That these are whole literals rather than assembled strings is not
        // visible here — the markup is the same either way — and is pinned as
        // source text in `utils/chartTone/index.spec.ts`.
        expect(wrapperClass('tile')).toContain('col-span-6 lg:col-span-3');
        expect(wrapperClass('wide')).toContain('col-span-12');
    });

    it('falls back to the md span for a size nobody offers [insights:I-20]', () => {
        renderSizes({ absent: undefined, typo: 'huge' });

        // A bare `SIZE_SPAN[size]` yields undefined here, `cn` drops it, and the
        // widget lands in one column of twelve — a sliver, with no error.
        expect(wrapperClass('typo')).toContain('col-span-12 lg:col-span-6');
        expect(wrapperClass('absent')).toContain('col-span-12 lg:col-span-6');
    });

    it('does not read a span off Object.prototype [insights:I-20]', () => {
        renderSizes({ inherited: 'constructor', stringly: 'toString' });

        // The guard is `Object.hasOwn`, not a truthiness check on the lookup:
        // `SIZE_SPAN['constructor']` reads back a function, which `cn` also
        // drops, and the widget ends up in the same one-column sliver.
        expect(wrapperClass('inherited')).toContain(
            'col-span-12 lg:col-span-6'
        );
        expect(wrapperClass('stringly')).toContain('col-span-12 lg:col-span-6');
    });
});
