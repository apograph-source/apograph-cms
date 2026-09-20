import { createSlot } from '@orthacms/utils-admin';
import { useIntl } from 'react-intl';
import { Outlet, useLocation } from 'react-router-dom';
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdmin } from '.';
import type { AdminPlugin } from '../types/adminPlugin';

/**
 * The host's **diagnostics**, and the two structural decisions around them.
 *
 * `apps/admin-e2e` drives the assembled application, and `apps/admin`'s
 * `plugins.spec.ts` asserts the shipped composition has no collisions. Both run
 * in the direction where nothing is wrong — so between them, every warning in
 * `createAdmin` could be deleted without a single test noticing. The whole point
 * of those warnings is the composition nobody has assembled yet: a plugin
 * installed from npm that happens to contribute a second `layout`, and takes the
 * auth gate with it.
 *
 * The collision and mount-element cases deliberately boot **without** a mount
 * element in the document. `createAdmin` warns, then throws on the missing
 * container, before it ever reaches `createRoot` — so one call exercises the
 * diagnostics with no React tree to tear down, and the throw doubles as proof
 * of what ran before the render.
 */

/** A plugin with nothing in it but a name. */
function pluginNamed(
    name: string,
    overrides: Partial<AdminPlugin> = {}
): AdminPlugin {
    return { name, ...overrides };
}

/**
 * Runs the host against a document with no mount element, returning the thrown
 * error. Everything before `createRoot` has happened by then.
 */
function bootUnmounted(options: Parameters<typeof createAdmin>[0]): unknown {
    try {
        createAdmin(options);
    } catch (error) {
        return error;
    }
    throw new Error('expected createAdmin to refuse a missing mount element');
}

describe('createAdmin — what it says before it renders', () => {
    /** The warnings the host emitted, as plain strings. */
    let warnings: string[];

    beforeEach(() => {
        warnings = [];
        vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
            warnings.push(String(args[0]));
        });
        document.documentElement.lang = '';
        document.documentElement.dir = '';
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('a missing mount element', () => {
        it('throws naming the id it looked for [bootstrap:I-28]', () => {
            const error = bootUnmounted({
                plugins: [],
                rootElement: 'ortha-admin-root'
            });

            // The thing being ruled out is `createRoot(getElementById(id)!)`,
            // which throws React's own "Target container is not a DOM element"
            // — true, and silent about *which* id the host was told to use,
            // with a blank page as the only other clue.
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toContain(
                'no element with id "ortha-admin-root"'
            );
        });
    });

    describe('two plugins contributing a layout', () => {
        const withLayout = (name: string) =>
            pluginNamed(name, { layout: <Outlet /> });

        it('warns naming the winner and every loser [bootstrap:I-27]', () => {
            bootUnmounted({
                plugins: [
                    withLayout('shell'),
                    withLayout('rogue'),
                    withLayout('also-rogue')
                ],
                rootElement: 'absent'
            });

            const collision = warnings.find((line) =>
                line.includes('contribute a layout')
            );
            // Naming both sides is the whole value: the loser is decided by
            // registration order, and if the loser is the shell every private
            // route renders without identity's `RequireAuth` around it.
            expect(collision).toContain('"shell"');
            expect(collision).toContain('"rogue"');
            expect(collision).toContain('"also-rogue"');
        });

        it('says nothing when exactly one plugin contributes one [bootstrap:I-27]', () => {
            bootUnmounted({
                plugins: [withLayout('shell'), pluginNamed('content')],
                rootElement: 'absent'
            });

            expect(
                warnings.filter((line) => line.includes('contribute a layout'))
            ).toEqual([]);
        });
    });

    describe('two plugins claiming one path', () => {
        const withRoute = (name: string, path: string) =>
            pluginNamed(name, {
                routes: [{ path, element: <h1>{name}</h1> }]
            });

        it('warns naming the path and both plugins [bootstrap:I-27]', () => {
            bootUnmounted({
                plugins: [
                    withRoute('content', '/entries'),
                    withRoute('transfer', '/entries'),
                    withRoute('media', '/assets')
                ],
                rootElement: 'absent'
            });

            const collisions = warnings.filter((line) =>
                line.includes('is contributed by')
            );
            // Exactly one: `/assets` has a single owner and must not be
            // reported, or the warning is noise and gets ignored.
            expect(collisions).toHaveLength(1);
            expect(collisions[0]).toContain('"/entries"');
            expect(collisions[0]).toContain('"content"');
            expect(collisions[0]).toContain('"transfer"');
        });
    });

    describe('slot contributions', () => {
        it('wires every plugin’s items before the render [bootstrap:I-22, shell:I-05]', () => {
            const slot = createSlot<{ id: string }>('spec.host.slot');

            bootUnmounted({
                plugins: [
                    pluginNamed('shell', {
                        slots: [{ slot, items: [{ id: 'shell-1' }] }]
                    }),
                    pluginNamed('content', {
                        slots: [{ slot, items: [{ id: 'content-1' }] }]
                    })
                ],
                rootElement: 'absent'
            });

            // Read after the missing-container throw, i.e. before `createRoot`.
            // `packages/utils/admin` pins that the wiring is idempotent; what it
            // cannot show is *when* the host runs it — and a consumer reads its
            // slot during the first render, so wiring after `root.render` gives
            // the shell an empty sidebar on the first paint. That ordering is
            // also the second half of `shell:I-05`, which is a statement about
            // the shell's sidebar but a decision only the host can make.
            expect(slot.getItems().map((item) => item.id)).toEqual([
                'shell-1',
                'content-1'
            ]);
        });
    });

    describe('the document’s language and direction', () => {
        it.each([
            ['de', 'ltr'],
            ['ar', 'rtl'],
            ['he', 'rtl'],
            ['en', 'ltr']
        ])(
            'declares lang=%s and dir=%s before the root is created [bootstrap:I-29]',
            (locale, direction) => {
                bootUnmounted({
                    plugins: [],
                    locale,
                    rootElement: 'absent'
                });

                // Read after a call that threw on the missing container — which
                // is *before* `createRoot`, let alone before React commits
                // anything. Moving either assignment below `root.render` fails
                // here, and that is the ordering the invariant is about: a
                // screen reader picks the document language up with the first
                // paint, not after a reconciliation.
                expect(document.documentElement.lang).toBe(locale);
                expect(document.documentElement.dir).toBe(direction);
            }
        );
    });
});

/** The `<div id="root">` the host's default `rootElement` looks for. */
function mountPoint(): void {
    const container = document.createElement('div');
    container.id = 'root';
    document.body.append(container);
}

describe('createAdmin — the assembled router', () => {
    beforeEach(mountPoint);

    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = '';
        window.history.replaceState({}, '', '/');
    });

    /** Two layouts, so "the first one found" is a claim with a loser. */
    const layoutPlugins = () => [
        pluginNamed('identity', {
            routes: [
                { path: '/signin', element: <h1>Sign in</h1>, public: true }
            ]
        }),
        pluginNamed('shell', {
            layout: (
                <div data-testid="shell-layout">
                    <Outlet />
                </div>
            ),
            routes: [{ path: '/private', element: <h1>Private</h1> }]
        }),
        pluginNamed('rogue', {
            layout: (
                <div data-testid="rogue-layout">
                    <Outlet />
                </div>
            )
        })
    ];

    it('renders a private route inside the first layout found, and only that one [bootstrap:I-25]', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        window.history.replaceState({}, '', '/private');

        await act(async () => {
            createAdmin({ plugins: layoutPlugins() });
        });

        await waitFor(() =>
            expect(screen.getByRole('heading').textContent).toBe('Private')
        );
        expect(screen.getByTestId('shell-layout')).toBeTruthy();
        // The loser is not mounted as a second parent, nested or beside: the
        // host picks one, warns, and mounts exactly it.
        expect(screen.queryByTestId('rogue-layout')).toBeNull();
    });

    it('renders a public route as a top-level sibling, outside every layout [bootstrap:I-25]', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        window.history.replaceState({}, '', '/signin');

        await act(async () => {
            createAdmin({ plugins: layoutPlugins() });
        });

        await waitFor(() =>
            expect(screen.getByRole('heading').textContent).toBe('Sign in')
        );
        // The sign-in screen rendering *inside* the shell's layout is the
        // failure this rules out — the layout composes identity's `RequireAuth`,
        // so a signed-out visitor would be redirected to sign in from the
        // sign-in page.
        expect(screen.queryByTestId('shell-layout')).toBeNull();
    });

    it('sends an unknown path through the private group, not past it [bootstrap:I-26]', async () => {
        // The fixture is built so the two placements of the `*` route differ.
        // Both redirect to `/`, so the destination proves nothing; what
        // separates them is whether the *layout* ever saw the unknown path.
        // Inside the group it does — which is what makes the redirect pass
        // through whatever gate the shell's layout composes — and beside the
        // group it would not.
        const seenByLayout: string[] = [];
        function RecordingLayout() {
            seenByLayout.push(useLocation().pathname);
            return <Outlet />;
        }

        window.history.replaceState({}, '', '/nope');

        await act(async () => {
            createAdmin({
                plugins: [
                    // `/` is public on purpose: after the redirect the layout is
                    // out of the picture, so the only way `/nope` reaches
                    // `seenByLayout` is the wildcard sitting inside the group.
                    pluginNamed('landing', {
                        routes: [
                            {
                                path: '/',
                                element: <h1>Landing</h1>,
                                public: true
                            }
                        ]
                    }),
                    pluginNamed('shell', {
                        layout: <RecordingLayout />,
                        routes: [
                            { path: '/private', element: <h1>Private</h1> }
                        ]
                    })
                ]
            });
        });

        await waitFor(() =>
            expect(screen.getByRole('heading').textContent).toBe('Landing')
        );
        expect(seenByLayout).toContain('/nope');
        expect(window.location.pathname).toBe('/');
    });
});

describe('createAdmin — missing translations', () => {
    let warned: string[];
    let errored: string[];

    /** Formats one descriptor three times, so a per-render report would show. */
    function Thrice() {
        const intl = useIntl();
        const format = () =>
            intl.formatMessage({
                id: 'bootstrap.spec.untranslated',
                defaultMessage: 'Untranslated'
            });
        return (
            <h1>
                {format()} {format()} {format()}
            </h1>
        );
    }

    beforeEach(() => {
        mountPoint();
        warned = [];
        errored = [];
        vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
            warned.push(String(args[0]));
        });
        vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
            errored.push(String(args[0]));
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    /** Lines mentioning the descriptor this suite formats. */
    const linesFor = (lines: string[]): string[] =>
        lines.filter((line) => line.includes('bootstrap.spec.untranslated'));

    it('reports an untranslated id once, at warn level [bootstrap:I-34]', async () => {
        await act(async () => {
            createAdmin({
                plugins: [
                    pluginNamed('spec', {
                        routes: [
                            { path: '/', element: <Thrice />, public: true }
                        ]
                    })
                ],
                locale: 'de'
            });
        });

        await waitFor(() => expect(screen.getByRole('heading')).toBeTruthy());

        // Three formats per render, and `StrictMode` renders twice — six
        // `MISSING_TRANSLATION` errors reach the handler. `react-intl` would put
        // every one of them on `console.error`; a single `/activity` load with
        // `locale: 'de'` produced 460 of them, which is what buries anything
        // real (ORT-141). Remove the `reported` set and this is 6, not 1.
        expect(linesFor(warned)).toHaveLength(1);
        expect(linesFor(warned)[0]).toContain('no "de" translation');
        // Warn, not error: a missing catalogue entry is a gap to fill, not a
        // failure of this render.
        expect(linesFor(errored)).toEqual([]);
    });

    it('says nothing when the locale is the default [bootstrap:I-34]', async () => {
        await act(async () => {
            createAdmin({
                plugins: [
                    pluginNamed('spec', {
                        routes: [
                            { path: '/', element: <Thrice />, public: true }
                        ]
                    })
                ],
                locale: 'en'
            });
        });

        await waitFor(() => expect(screen.getByRole('heading')).toBeTruthy());

        expect(linesFor(warned)).toEqual([]);
        expect(linesFor(errored)).toEqual([]);
    });
});
