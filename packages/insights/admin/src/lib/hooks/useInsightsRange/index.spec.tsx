import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom';
import { InsightsRangeProvider, useInsightsRange } from './index';
import { DEFAULT_RANGE, RANGE_DAYS } from '../../utils/insightsRange';

/**
 * The provider's URL contract, and the fallback a widget gets without it.
 *
 * `parseInsightsRange` is already unit-tested next to itself and the visible
 * round-trip (`?range=90d` appearing, surviving a reload, disappearing again on
 * the default) is pinned in `admin-e2e`. What is left are the three clauses a
 * browser test cannot state cheaply: that a range change *replaces* rather than
 * pushes, that it merges into whatever else is in the query string, and that a
 * widget rendered somewhere with no Insights page around it gets the default
 * window instead of an exception.
 */

/** Renders the live context value, plus the router's view of how we got here. */
function Probe() {
    const { range, days, setRange } = useInsightsRange();
    const location = useLocation();
    const navigationType = useNavigationType();

    return (
        <div>
            <span data-testid="range">{range}</span>
            <span data-testid="days">{days}</span>
            <span data-testid="search">{location.search}</span>
            <span data-testid="navigation-type">{navigationType}</span>
            <button type="button" onClick={() => setRange('90d')}>
                to 90d
            </button>
            <button type="button" onClick={() => setRange(DEFAULT_RANGE)}>
                to default
            </button>
        </div>
    );
}

const text = (id: string) => screen.getByTestId(id).textContent;

describe('useInsightsRange outside its provider', () => {
    it('returns the default window rather than throwing [insights:I-19]', () => {
        // No InsightsRangeProvider and no router at all: this is a contributed
        // widget being rendered by whoever owns it, in a test or a storybook.
        render(<Probe />, {
            wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>
        });

        expect(text('range')).toBe(DEFAULT_RANGE);
        expect(text('days')).toBe(String(RANGE_DAYS[DEFAULT_RANGE]));
    });

    it('hands back a setRange that is inert rather than absent [insights:I-19]', () => {
        render(
            <MemoryRouter initialEntries={['/insights']}>
                <Probe />
            </MemoryRouter>
        );

        // The fallback has to be callable — a widget with its own range control
        // would otherwise crash on `setRange is not a function` — and it has to
        // do nothing, since there is no URL here that owns a selection.
        fireEvent.click(screen.getByRole('button', { name: 'to 90d' }));

        expect(text('range')).toBe(DEFAULT_RANGE);
        expect(text('search')).toBe('');
    });
});

describe('InsightsRangeProvider', () => {
    it('merges the range into the existing query string [insights:I-18]', () => {
        render(
            <MemoryRouter initialEntries={['/insights?foo=1']}>
                <InsightsRangeProvider>
                    <Probe />
                </InsightsRangeProvider>
            </MemoryRouter>
        );

        fireEvent.click(screen.getByRole('button', { name: 'to 90d' }));

        // `foo=1` belongs to the shell or to a contributed widget; a range
        // change that wrote a fresh URLSearchParams would drop it silently.
        expect(text('search')).toBe('?foo=1&range=90d');
        expect(text('range')).toBe('90d');

        // And clearing back to the default removes only its own parameter.
        fireEvent.click(screen.getByRole('button', { name: 'to default' }));

        expect(text('search')).toBe('?foo=1');
    });

    it('replaces the history entry rather than pushing one [insights:I-18]', () => {
        render(
            <MemoryRouter initialEntries={['/insights']}>
                <InsightsRangeProvider>
                    <Probe />
                </InsightsRangeProvider>
            </MemoryRouter>
        );

        expect(text('navigation-type')).toBe('POP');

        fireEvent.click(screen.getByRole('button', { name: 'to 90d' }));

        // The picker is a view control: Back has to leave the page, not rewind
        // through every window the reader tried on the way.
        expect(text('navigation-type')).toBe('REPLACE');
        expect(text('range')).toBe('90d');
    });
});
