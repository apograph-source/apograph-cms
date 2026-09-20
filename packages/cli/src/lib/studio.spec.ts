import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const execFileSync = jest.fn();

jest.mock('node:child_process', () => ({
    execFileSync: (...args: unknown[]) => execFileSync(...args)
}));

import { runDrizzleKitStudio } from './studio';

const URL = 'postgresql://ortha:secret@localhost:5432/ortha_cms';

/** The temp config path drizzle-kit was pointed at, and its contents. */
function ephemeralConfig(): { path: string; contents: string } {
    const path = String(
        execFileSync.mock.calls[0][1].find((arg: string) =>
            arg.startsWith('--config=')
        )
    ).slice('--config='.length);

    return { path, contents: readFileSync(path, 'utf8') };
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Read the temp config before the `finally` removes it.
    execFileSync.mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('runDrizzleKitStudio', () => {
    it('hands drizzle-kit an ephemeral config that never holds the credential [cli:I-10] [nx:I-10]', () => {
        let contents = '';
        execFileSync.mockImplementation(() => {
            contents = ephemeralConfig().contents;
        });

        runDrizzleKitStudio(URL);

        expect(contents).toContain('process.env.DATABASE_URL');
        expect(contents).not.toContain('secret');
        expect(contents).not.toContain('ortha_cms');
    });

    it('passes the URL through the child’s environment instead [cli:I-10] [nx:I-10]', () => {
        runDrizzleKitStudio(URL);

        expect(execFileSync.mock.calls[0][2].env).toMatchObject({
            DATABASE_URL: URL
        });
    });

    it('removes the temp directory when Studio exits [nx:I-11]', () => {
        let path = '';
        execFileSync.mockImplementation(() => {
            path = ephemeralConfig().path;
        });

        runDrizzleKitStudio(URL);

        expect(existsSync(path)).toBe(false);
    });

    it('leaves host and port to drizzle-kit’s defaults when neither is given', () => {
        runDrizzleKitStudio(URL);

        expect(
            execFileSync.mock.calls[0][1].filter(
                (a: string) => a.startsWith('--host') || a.startsWith('--port')
            )
        ).toEqual([]);
    });

    it('forwards host and port when they are given', () => {
        runDrizzleKitStudio(URL, { host: '0.0.0.0', port: 4990 });

        expect(execFileSync.mock.calls[0][1]).toEqual(
            expect.arrayContaining(['--host=0.0.0.0', '--port=4990'])
        );
    });

    /**
     * The port that used to disappear.
     *
     * `if (options.port)` treated `0` as "not given", so `--port=0` started
     * Studio on 4983 and said nothing — while `@orthacms/nx`'s `db:studio`
     * executor refused the same input with an explanation, so one flag on one
     * tool meant two different things depending on which half of the workspace
     * you were standing in.
     *
     * The refusal is the right half of that pair, and the reason is in
     * drizzle-kit: its listen callback is handed the bound address and ignores
     * it, printing the port it was *asked* for. Forwarded, `--port=0` would put
     * an unauthenticated read/write console on the database at an ephemeral
     * port and announce a URL naming port 0.
     */
    describe('a port drizzle-kit could bind but could not report', () => {
        it('refuses --port=0 instead of silently using the default', () => {
            expect(() => runDrizzleKitStudio(URL, { port: 0 })).toThrow(
                /port 0 is not supported/
            );

            expect(execFileSync).not.toHaveBeenCalled();
        });

        /**
         * The other values a mistyped flag produces. All of them were falsy or
         * merely nonsensical, and all of them were dropped by the same guard —
         * `--port=abc` arrives as `NaN`, and `--port=70000` as a number no
         * socket can bind.
         */
        it.each([
            ['NaN, from a non-numeric --port', Number.NaN],
            ['a fractional port', 4983.5],
            ['a negative port', -1],
            ['a port past the 16-bit ceiling', 70000]
        ])('refuses %s', (_label, port) => {
            expect(() => runDrizzleKitStudio(URL, { port })).toThrow(
                /is not a port/
            );

            expect(execFileSync).not.toHaveBeenCalled();
        });

        it('refuses before it writes the ephemeral config, so nothing is left behind', () => {
            const before = readdirSync(tmpdir()).filter((entry) =>
                entry.startsWith('ortha-studio-')
            );

            expect(() => runDrizzleKitStudio(URL, { port: 0 })).toThrow();

            expect(
                readdirSync(tmpdir()).filter((entry) =>
                    entry.startsWith('ortha-studio-')
                )
            ).toEqual(before);
        });

        it('still forwards every port that can be reported', () => {
            for (const port of [1, 4983, 65535]) {
                jest.clearAllMocks();
                runDrizzleKitStudio(URL, { port });

                expect(execFileSync.mock.calls[0][1]).toContain(
                    `--port=${port}`
                );
            }
        });
    });

    /**
     * Studio has no authentication and full read/write access to the database.
     * On loopback that is a local tool; on any other interface it is a database
     * console offered to the network, and drizzle-kit says nothing about the
     * difference.
     */
    describe('binding a non-loopback interface', () => {
        it('warns, naming the exposure and how to undo it [cli:I-11] [nx:I-13]', () => {
            runDrizzleKitStudio(URL, { host: '0.0.0.0' });

            const warning = (console.warn as jest.Mock).mock.calls[0][0];
            expect(warning).toContain('0.0.0.0:4983');
            expect(warning).toContain('no authentication');
            expect(warning).toContain('Drop --host');
            // *Before* startup, which is the half of the invariant a message
            // printed afterwards would not satisfy: Studio is reachable from
            // the moment drizzle-kit binds, so a warning that arrives after it
            // is a note about something already happening.
            expect(
                (console.warn as jest.Mock).mock.invocationCallOrder[0]
            ).toBeLessThan(execFileSync.mock.invocationCallOrder[0]);
        });

        it('names the port it was actually given', () => {
            runDrizzleKitStudio(URL, { host: '10.0.0.5', port: 4990 });

            expect((console.warn as jest.Mock).mock.calls[0][0]).toContain(
                '10.0.0.5:4990'
            );
        });

        it.each(['localhost', '127.0.0.1', '::1', 'LOCALHOST'])(
            'stays quiet for %s',
            (host) => {
                runDrizzleKitStudio(URL, { host });

                expect(console.warn).not.toHaveBeenCalled();
            }
        );

        it('stays quiet when no host was asked for at all', () => {
            runDrizzleKitStudio(URL);

            expect(console.warn).not.toHaveBeenCalled();
        });
    });

    /**
     * Ctrl+C is the documented way to stop Studio, and `execFileSync` throws
     * when its child is signalled. Reporting the documented exit as a failed
     * target trains people to ignore red.
     */
    it.each(['SIGINT', 'SIGTERM'])(
        // covers: cli:I-18, nx:I-14
        'exits cleanly when stopped with %s',
        (signal) => {
            execFileSync.mockImplementation(() => {
                throw Object.assign(new Error('killed'), { signal });
            });

            expect(() => runDrizzleKitStudio(URL)).not.toThrow();
        }
    );

    it('still reports a genuine drizzle-kit failure', () => {
        execFileSync.mockImplementation(() => {
            throw Object.assign(new Error('bad config'), {
                status: 1,
                signal: null
            });
        });

        expect(() => runDrizzleKitStudio(URL)).toThrow('bad config');
    });

    it('cleans up the temp directory even when Studio fails [cli:I-10] [nx:I-11]', () => {
        let path = '';
        execFileSync.mockImplementation(() => {
            path = ephemeralConfig().path;
            throw Object.assign(new Error('bad config'), { status: 1 });
        });

        expect(() => runDrizzleKitStudio(URL)).toThrow();
        expect(existsSync(path)).toBe(false);
    });
});
