import { PassThrough } from 'node:stream';
import { multiselect, select, type Choice } from './ui';

const ESC = '\u001b';
const ENTER = '\r';
const SPACE = ' ';
const DOWN = `${ESC}[B`;
const UP = `${ESC}[A`;

const MEDIA: Choice[] = [
    { value: 'media-local', label: 'Local filesystem', selected: true },
    { value: 'media-azure', label: 'Azure Blob Storage' },
    { value: 'media-s3', label: 'S3-compatible', disabled: true }
];

const COPILOT: Choice[] = [
    { value: 'copilot-anthropic', label: 'Claude (Anthropic)' },
    { value: 'copilot-openai', label: 'OpenAI-compatible endpoint' }
];

const PROTOCOLS: Choice[] = [
    { value: 'rest', label: 'REST', locked: true },
    { value: 'graphql', label: 'GraphQL content API' },
    { value: 'mcp', label: 'MCP server' }
];

/** A stand-in for a terminal, with the raw-mode calls it was given recorded. */
interface FakeStdin extends PassThrough {
    isTTY: boolean;
    isRaw: boolean;
    /** Every `setRawMode` argument, in order. */
    rawModeCalls: boolean[];
    setRawMode(mode: boolean): FakeStdin;
}

/**
 * A stand-in for a terminal: a stream the test can type into, claiming to be a
 * TTY so the pickers treat it as one.
 *
 * `setRawMode` **records**, and moves `isRaw` with it. A stub that accepted the
 * call and forgot it would let the pickers leave a real terminal in raw mode
 * with nothing to notice — the user's echo is gone and they have to type
 * `reset` blind — so the fixture has to be able to tell the two apart.
 */
function fakeStdin(): FakeStdin {
    const stream = new PassThrough() as FakeStdin;
    stream.isTTY = true;
    stream.isRaw = false;
    stream.rawModeCalls = [];
    stream.setRawMode = (mode: boolean) => {
        stream.rawModeCalls.push(mode);
        stream.isRaw = mode;
        return stream;
    };
    return stream;
}

describe('the keyboard pickers', () => {
    const realStdin = Object.getOwnPropertyDescriptor(process, 'stdin');
    let stdin: FakeStdin;
    let painted: jest.SpyInstance;

    beforeEach(() => {
        stdin = fakeStdin();
        Object.defineProperty(process, 'stdin', {
            value: stdin,
            configurable: true
        });
        painted = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    });

    afterEach(() => {
        if (realStdin) Object.defineProperty(process, 'stdin', realStdin);
        painted.mockRestore();
    });

    /** Types `keys` one keypress at a time, as a terminal delivers them. */
    async function type(...keys: string[]): Promise<void> {
        for (const key of keys) {
            stdin.write(key);
            await new Promise((resolve) => setImmediate(resolve));
        }
    }

    describe('select', () => {
        it('answers with the focused row', async () => {
            const answer = select('Where?', MEDIA);
            await type(ENTER);

            await expect(answer).resolves.toBe('media-local');
        });

        it('moves the cursor with the arrow keys', async () => {
            const answer = select('Where?', MEDIA);
            await type(DOWN, ENTER);

            await expect(answer).resolves.toBe('media-azure');
        });

        it('wraps past the unavailable row rather than landing on it', async () => {
            const answer = select('Where?', MEDIA);
            await type(DOWN, DOWN, ENTER);

            await expect(answer).resolves.toBe('media-local');
        });

        it('answers with undefined when escaped', async () => {
            const answer = select('Where?', MEDIA);
            await type(ESC);

            await expect(answer).resolves.toBeUndefined();
        });
    });

    describe('multiselect', () => {
        it('answers with the ticked rows', async () => {
            const answer = multiselect('Which backends?', COPILOT);
            await type(SPACE, DOWN, SPACE, ENTER);

            await expect(answer).resolves.toEqual([
                'copilot-anthropic',
                'copilot-openai'
            ]);
        });

        it('answers with nothing ticked, which is a real answer', async () => {
            const answer = multiselect('Which backends?', COPILOT);
            await type(ENTER);

            await expect(answer).resolves.toEqual([]);
        });
    });

    /**
     * REST is `locked`: ticked, dimmed, and not something the answer can be
     * without. The row is *shown* rather than hidden so "which protocols does
     * this app speak" reads as a complete set — which only works if the row
     * cannot be interacted with, since a box the space bar appears to untick
     * and does not is worse than no box at all.
     */
    describe('a locked row', () => {
        it('is in the answer with nothing pressed [create-apograph-app:I-10]', async () => {
            const answer = multiselect('Which protocols?', PROTOCOLS);
            await type(ENTER);

            await expect(answer).resolves.toEqual(['rest']);
        });

        it('does not take the cursor, so the space bar lands elsewhere [create-apograph-app:I-10]', async () => {
            const answer = multiselect('Which protocols?', PROTOCOLS);
            // The cursor starts on the first row it may land on — GraphQL —
            // and stepping up from there wraps past REST onto MCP rather than
            // stopping on it.
            await type(SPACE, UP, SPACE, ENTER);

            await expect(answer).resolves.toEqual(['rest', 'graphql', 'mcp']);
        });

        it('cannot be unticked by the space bar [create-apograph-app:I-10]', async () => {
            const answer = multiselect('Which protocols?', PROTOCOLS);
            // Every row, twice round, with the space bar on each: whatever the
            // cursor is allowed to reach gets toggled on and off again, and
            // REST is still in the answer.
            await type(
                SPACE,
                SPACE,
                DOWN,
                SPACE,
                SPACE,
                DOWN,
                SPACE,
                SPACE,
                ENTER
            );

            await expect(answer).resolves.toEqual(['rest']);
        });
    });

    /**
     * Raw mode is what makes the arrow keys work without Enter, and a process
     * that leaves stdin in it hands the terminal back with no echo — the user
     * types `reset` blind to get it working again. So it is restored on every
     * way out of a picker, not just the happy one.
     */
    describe('raw mode', () => {
        it('is left as it was found once a picker is answered [create-apograph-app:I-21]', async () => {
            const answer = multiselect('Which backends?', COPILOT);
            await type(SPACE);
            expect(stdin.isRaw).toBe(true);
            await type(ENTER);
            await answer;

            expect(stdin.rawModeCalls).toEqual([true, false]);
            expect(stdin.isRaw).toBe(false);
        });

        it('is left as it was found when the picker is cancelled [create-apograph-app:I-21]', async () => {
            const answer = select('Where?', MEDIA);
            await type(ESC);

            await expect(answer).resolves.toBeUndefined();
            expect(stdin.rawModeCalls).toEqual([true, false]);
            expect(stdin.isRaw).toBe(false);
        });

        it('is left as it was found when stdin errors [create-apograph-app:I-21]', async () => {
            const answer = select('Where?', MEDIA);
            await new Promise((resolve) => setImmediate(resolve));
            stdin.emit('error', new Error('stdin went away'));

            await expect(answer).rejects.toThrow('stdin went away');
            expect(stdin.rawModeCalls).toEqual([true, false]);
            expect(stdin.isRaw).toBe(false);
        });
    });

    /**
     * The wizard asks four of these in a row. Reading keys with
     * `for await (const chunk of stdin)` used to destroy stdin as soon as a
     * picker was answered, so the *second* picker rejected with
     * `AbortError: The operation was aborted` the moment it painted — the media
     * question answered, and the copilot question aborting the scaffold before
     * anyone could press a key.
     */
    it('keeps stdin readable for the picker after it', async () => {
        const media = select('Where should uploads be stored?', MEDIA);
        await type(ENTER);
        await expect(media).resolves.toBe('media-local');
        expect(stdin.destroyed).toBe(false);

        const copilot = multiselect('Which model backends?', COPILOT);
        await type(SPACE, ENTER);
        await expect(copilot).resolves.toEqual(['copilot-anthropic']);

        const sso = multiselect('Which identity providers?', COPILOT);
        await type(ENTER);
        await expect(sso).resolves.toEqual([]);

        const protocols = select('Which protocols?', MEDIA);
        await type(ENTER);
        await expect(protocols).resolves.toBe('media-local');
    });
});
