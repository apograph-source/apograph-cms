import {
    flag,
    halves,
    numberOption,
    option,
    wantsHelp,
    wantsVersion
} from './args';

describe('wantsHelp', () => {
    // The regression: `--help` lands in the command position, so a check that
    // only read the arguments after it answered with `Unknown command`.
    it.each([['--help'], ['-h'], ['help']])(
        'treats a bare %s as a request for the usage text',
        (arg) => {
            expect(wantsHelp([arg])).toBe(true);
        }
    );

    it('shows the usage text when nothing at all was typed', () => {
        expect(wantsHelp([])).toBe(true);
    });

    it('answers a help flag asked after a command', () => {
        expect(wantsHelp(['migrate', '--help'])).toBe(true);
        expect(wantsHelp(['build', '-h'])).toBe(true);
    });

    it('leaves real commands to run', () => {
        expect(wantsHelp(['migrate'])).toBe(false);
        expect(wantsHelp(['build', '--server'])).toBe(false);
        expect(wantsHelp(['generate', '--name=add_posts'])).toBe(false);
    });

    it('does not mistake a value that merely says help for the flag', () => {
        expect(wantsHelp(['generate', '--name=help'])).toBe(false);
    });
});

describe('option', () => {
    it('reads both --flag=value and --flag value', () => {
        expect(option(['--name=add_posts'], 'name')).toBe('add_posts');
        expect(option(['--name', 'add_posts'], 'name')).toBe('add_posts');
    });

    it('is undefined when absent, or when the next token is another flag', () => {
        expect(option(['--server'], 'name')).toBeUndefined();
        expect(option(['--name', '--server'], 'name')).toBeUndefined();
    });
});

describe('flag', () => {
    it('is true only for the bare flag', () => {
        expect(flag(['--server'], 'server')).toBe(true);
        expect(flag(['--admin'], 'server')).toBe(false);
    });
});

describe('wantsVersion', () => {
    it.each([['--version'], ['-v']])('recognises a bare %s', (arg) => {
        expect(wantsVersion([arg])).toBe(true);
    });

    it('recognises the flag asked after a command', () => {
        expect(wantsVersion(['migrate', '--version'])).toBe(true);
    });

    it('leaves real commands to run', () => {
        expect(wantsVersion([])).toBe(false);
        expect(wantsVersion(['migrate'])).toBe(false);
        expect(wantsVersion(['build', '--server'])).toBe(false);
    });

    // The precedence `cli.ts` relies on: it asks this first, so the pair has
    // to be answerable by the version rather than swallowed by the help.
    it('is true alongside a help flag, which cli.ts checks second', () => {
        expect(wantsVersion(['--version', '--help'])).toBe(true);
    });
});

describe('halves', () => {
    it('reads the half a command was narrowed to', () => {
        expect(halves(['--server'], 'dev')).toEqual({
            serverOnly: true,
            adminOnly: false
        });
        expect(halves(['--admin'], 'dev')).toEqual({
            serverOnly: false,
            adminOnly: true
        });
    });

    it('is both halves when neither flag was given', () => {
        expect(halves([], 'build')).toEqual({
            serverOnly: false,
            adminOnly: false
        });
    });

    /**
     * `--server` skips the admin and `--admin` skips the server, so together
     * they ask for neither: `ortha build --server --admin` used to compile
     * nothing, build nothing and exit 0 — a build that looks like it worked.
     */
    it('refuses both at once, naming what each of them skips', () => {
        expect(() => halves(['--server', '--admin'], 'build')).toThrow(
            /asks for neither half/
        );
    });
});

describe('numberOption', () => {
    it('is undefined when the flag is absent', () => {
        expect(numberOption([], 'port')).toBeUndefined();
    });

    /**
     * The regression this exists for is `0`, in both directions: it has to
     * survive the parse (`Number(raw)`, not a truthiness test) so the command
     * can decide what to do with it, rather than disappearing on the way in.
     */
    it('keeps a zero, which is the value a truthiness test loses', () => {
        expect(numberOption(['--port=0'], 'port')).toBe(0);
        expect(numberOption(['--port', '0'], 'port')).toBe(0);
    });

    it('reads a real port from either form', () => {
        expect(numberOption(['--port=4990'], 'port')).toBe(4990);
        expect(numberOption(['--port', '4990'], 'port')).toBe(4990);
    });

    /**
     * `Number('abc')` is `NaN` and `Number('')` is `0`, and both used to reach
     * the studio guard as something falsy that it then dropped without a word.
     * A mistyped port is a typo to report, not a default to fall back to.
     */
    it.each([['abc'], [''], ['4990.5'], ['-1'], ['1e3']])(
        'refuses --port=%s rather than coercing it',
        (raw) => {
            expect(() => numberOption([`--port=${raw}`], 'port')).toThrow(
                /must be a whole number/
            );
        }
    );
});
