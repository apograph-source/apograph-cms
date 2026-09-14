import {
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync
} from 'node:fs';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { USAGE, lockedOf, main, resolveAnswers } from './run';
import { PROTOCOLS } from './features';

/**
 * The scaffolder driven the way `npx create-apograph-app` drives it, minus the
 * network: `--no-install` and `--no-git` are the only two things the run is
 * spared, so everything up to and including the files on disk is the real path.
 */

const ESC = '\u001b';
/** The SGR sequences `ui` paints with, so a match is on the text itself. */
const ESCAPES = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

let target: string;
let printed: string[];
let log: jest.SpyInstance;

beforeEach(() => {
    target = mkdtempSync(join(tmpdir(), 'create-apograph-run-'));
    printed = [];
    log = jest
        .spyOn(console, 'log')
        .mockImplementation((...args: unknown[]) => {
            printed.push(args.map(String).join(' ').replace(ESCAPES, ''));
        });
});

afterEach(() => {
    log.mockRestore();
    rmSync(target, { recursive: true, force: true });
});

/** Scaffolds into `target` with the given extra flags. */
function scaffold(...flags: string[]): Promise<void> {
    return main([target, '--no-install', '--no-git', ...flags]);
}

/** Every file in the generated app, as paths relative to its root. */
function generatedFiles(dir = target): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        return entry.isDirectory()
            ? generatedFiles(path)
            : [relative(target, path)];
    });
}

/**
 * Pretends both halves of the terminal are (or are not) a TTY, over a stdin
 * that is already at end of input.
 *
 * The empty stdin is what makes a regression here *fail* rather than hang: a
 * scaffolder that decided to ask a question would block forever on the real
 * stdin, and a suite that never returns is a worse signal than a red one.
 */
function withTty(isTty: boolean): () => void {
    const ended = new PassThrough();
    Object.assign(ended, { isTTY: isTty });
    ended.end();

    const realStdin = Object.getOwnPropertyDescriptor(process, 'stdin');
    Object.defineProperty(process, 'stdin', {
        value: ended,
        configurable: true
    });

    const stdout = process.stdout;
    const wasTty = stdout.isTTY;
    Object.defineProperty(stdout, 'isTTY', {
        value: isTty,
        configurable: true
    });

    return () => {
        if (realStdin) Object.defineProperty(process, 'stdin', realStdin);
        Object.defineProperty(stdout, 'isTTY', {
            value: wasTty,
            configurable: true
        });
    };
}

describe('an existing directory', () => {
    /**
     * The refusal has to come *before* the first write, not after the first
     * collision: half a scaffold written over someone's project is worse than
     * either outcome, and there is no undo.
     */
    it('is never written into when it holds anything [create-apograph-app:I-19]', async () => {
        writeFileSync(join(target, 'notes.md'), 'work in progress');

        await expect(scaffold('--yes')).rejects.toThrow(
            /already exists and is not empty/
        );

        expect(generatedFiles()).toEqual(['notes.md']);
        expect(readFileSync(join(target, 'notes.md'), 'utf8')).toBe(
            'work in progress'
        );
    });

    it('is scaffolded into when it is empty', async () => {
        await scaffold('--yes');

        expect(generatedFiles()).toContain('package.json');
    });
});

describe('answering without being asked', () => {
    /**
     * A scaffolder that blocks on a prompt in CI hangs the job until it times
     * out, which is a far worse failure than defaulting — so the run has to be
     * finishable with no one at the keyboard. Both ways in are covered: an
     * explicit `--yes`, and a pipe with no terminal behind it. Either one
     * regressing shows up here as a test that never returns.
     */
    it('asks nothing when --yes is passed, terminal or not [create-apograph-app:I-20]', async () => {
        const restore = withTty(true);
        try {
            await scaffold('--yes');
        } finally {
            restore();
        }

        expect(printed.join('\n')).not.toMatch(
            /App name|Database URL|Admin email/
        );
        expect(generatedFiles()).toContain('package.json');
    });

    it('asks nothing when there is no terminal to ask in [create-apograph-app:I-20]', async () => {
        const restore = withTty(false);
        try {
            await scaffold();
        } finally {
            restore();
        }

        expect(printed.join('\n')).not.toMatch(
            /App name|Database URL|Admin email/
        );
        expect(generatedFiles()).toContain('package.json');
    });

    /**
     * The other half of the same promise: a run that cannot ask still has to be
     * able to answer, so every question the wizard asks has a flag that answers
     * it. The flags are the contract, so they are checked here rather than
     * against the prose that describes them.
     */
    it.each([
        ['--media', 'media-gcs', 'media-gcs'],
        ['--copilot', 'copilot-openai', 'copilot-openai'],
        ['--sso', 'sso-saml', 'sso-saml'],
        ['--protocols', 'graphql', 'graphql'],
        ['--mail', 'mail-smtp', 'mail-smtp']
    ])(
        'answers the %s question from the command line [create-apograph-app:I-20]',
        async (flag, value, id) => {
            expect(USAGE).toContain(flag);

            const answers = await resolveAnswers(
                ['--yes', flag, value],
                'my-cms'
            );

            expect([...answers.selection.enabled]).toContain(id);
        }
    );
});

describe('REST', () => {
    /**
     * `--protocols none` is a real answer to "which protocols beyond REST", and
     * it still yields REST: the locked ids are added to whatever came back,
     * because REST is not something a flag can switch off — every other
     * protocol is an adapter over it.
     */
    it('is in the answer even when the flag says none [create-apograph-app:I-10]', async () => {
        const answers = await resolveAnswers(
            ['--yes', '--protocols', 'none'],
            'my-cms'
        );

        expect([...answers.selection.enabled]).toContain('rest');
        expect([...answers.selection.enabled]).not.toContain('graphql');
        expect([...answers.selection.enabled]).not.toContain('mcp');
    });

    it('survives a flag that names only the other protocols [create-apograph-app:I-10]', async () => {
        const answers = await resolveAnswers(
            ['--yes', '--protocols', 'mcp'],
            'my-cms'
        );

        expect([...answers.selection.enabled]).toEqual(
            expect.arrayContaining(['rest', 'mcp'])
        );
    });

    it('is the only protocol nobody has to ask for [create-apograph-app:I-10]', () => {
        expect(lockedOf(PROTOCOLS)).toEqual(['rest']);
    });
});

describe('the administrator’s password', () => {
    /** `APOGRAPH_ROOT_ADMIN_PASSWORD=…` out of the generated `.env`. */
    function passwordFrom(env: string): string {
        const match = /^APOGRAPH_ROOT_ADMIN_PASSWORD=(.+)$/m.exec(env);
        expect(match).not.toBeNull();
        return (match as RegExpExecArray)[1] as string;
    }

    /**
     * Generated rather than prompted, because a password typed at a prompt is
     * echoed to the terminal and lands in shell history — and then it exists in
     * exactly two places: the `.env` that `.gitignore` covers, and the one line
     * that tells the user what it is. A third copy is a secret in a file
     * somebody commits.
     */
    it('is written to .env, printed once, and left nowhere else [create-apograph-app:I-18]', async () => {
        await scaffold('--yes');

        const password = passwordFrom(
            readFileSync(join(target, '.env'), 'utf8')
        );
        expect(password).toMatch(/^[A-Za-z0-9_-]{8,}$/);

        const carriers = generatedFiles().filter((file) =>
            readFileSync(join(target, file), 'utf8').includes(password)
        );
        expect(carriers).toEqual(['.env']);

        expect(readFileSync(join(target, '.gitignore'), 'utf8')).toMatch(
            /^\.env$/m
        );

        const occurrences = printed.join('\n').split(password).length - 1;
        expect(occurrences).toBe(1);
    });

    it('is a fresh secret on every run, not a template value [create-apograph-app:I-18]', async () => {
        await scaffold('--yes');
        const first = passwordFrom(readFileSync(join(target, '.env'), 'utf8'));

        rmSync(target, { recursive: true, force: true });
        target = mkdtempSync(join(tmpdir(), 'create-apograph-run-'));
        await scaffold('--yes');
        const second = passwordFrom(readFileSync(join(target, '.env'), 'utf8'));

        expect(second).not.toBe(first);
    });

    it('is never asked for', async () => {
        await scaffold('--yes');

        expect(USAGE).not.toMatch(/--password/);
        expect(printed.join('\n')).not.toMatch(
            /Choose a password|Admin password \(/
        );
        expect(statSync(join(target, '.env')).isFile()).toBe(true);
    });
});
