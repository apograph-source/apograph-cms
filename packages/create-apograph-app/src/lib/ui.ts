/**
 * A small terminal UI — boxes, colour, and keyboard pickers.
 *
 * Hand-rolled rather than pulled from `prompts`/`clack`/`chalk`, because this
 * package is what `npx` downloads before anything else exists: every dependency
 * is weight on the very first thing a new user waits for, and a scaffolder that
 * needs a dependency tree to ask four questions is not a good first impression.
 * It is also the one package here with no runtime dependencies at all, which is
 * worth keeping.
 *
 * Everything degrades. No TTY, `NO_COLOR`, a dumb terminal, `--yes` — the
 * pickers never run and the defaults are used, so this behaves the same in CI
 * as in a terminal.
 */

const ESC = '\u001b';
const CSI = `${ESC}[`;

/** Whether ANSI colour should be emitted at all. */
const COLOR =
    process.stdout.isTTY === true &&
    !process.env['NO_COLOR'] &&
    process.env['TERM'] !== 'dumb';

/** Wraps `text` in an SGR pair, or returns it untouched when colour is off. */
function sgr(open: number, close: number) {
    return (text: string): string =>
        COLOR ? `${CSI}${open}m${text}${CSI}${close}m` : text;
}

export const bold = sgr(1, 22);
export const dim = sgr(2, 22);
export const red = sgr(31, 39);
export const green = sgr(32, 39);
export const yellow = sgr(33, 39);
export const cyan = sgr(36, 39);
export const magenta = sgr(35, 39);

/** Visible width of `text`, ignoring the ANSI escapes inside it. */
export function width(text: string): number {
    return text.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '').length;
}

/**
 * Clips `text` to `size` visible columns.
 *
 * `keep: 'end'` drops characters from the front, which is what a long path
 * wants — the tail (`…/scratchpad/v2/minimal`) is the part that identifies it,
 * and clipping the other way leaves every line reading the same.
 *
 * Only ever called on plain text. Clipping a coloured string could cut an ANSI
 * escape in half and leak the rest of the line's colour into the box border.
 */
function truncate(text: string, size: number, keep: 'start' | 'end'): string {
    if (text.length <= size) return text;
    if (size <= 1) return '…';

    return keep === 'end'
        ? `…${text.slice(text.length - (size - 1))}`
        : `${text.slice(0, size - 1)}…`;
}

/** Pads `text` to exactly `size` visible columns, clipping if it overflows. */
function pad(text: string, size: number): string {
    const visible = width(text);
    if (visible > size) return truncate(text, size, 'start');

    return text + ' '.repeat(Math.max(0, size - visible));
}

const BOX = 66;

/** Prints a boxed banner. */
export function banner(title: string, subtitle: string): void {
    const inner = BOX - 2;
    console.log('');
    console.log(magenta(`╭${'─'.repeat(inner)}╮`));
    console.log(
        `${magenta('│')} ${pad(bold(title), inner - 2)} ${magenta('│')}`
    );
    console.log(
        `${magenta('│')} ${pad(dim(truncate(subtitle, inner - 2, 'end')), inner - 2)} ${magenta('│')}`
    );
    console.log(magenta(`╰${'─'.repeat(inner)}╯`));
}

/** Prints a section heading. */
export function section(title: string): void {
    console.log('');
    console.log(`${cyan('◆')} ${bold(title)}`);
}

/** Prints an indented note. */
export function note(text: string): void {
    console.log(`  ${dim(text)}`);
}

/** Prints a success line. */
export function success(text: string): void {
    console.log(`${green('✔')} ${text}`);
}

/** Prints a warning line. */
export function warn(text: string): void {
    console.log(`${yellow('!')} ${text}`);
}

/** Prints an error line to stderr. */
export function error(text: string): void {
    console.error(`${red('✖')} ${text}`);
}

/** Prints a boxed summary of label/value rows. */
export function summary(
    title: string,
    rows: readonly (readonly [string, string])[]
): void {
    const inner = BOX - 2;
    const rule = '─'.repeat(Math.max(0, inner - width(title) - 3));
    console.log('');
    console.log(dim(`╭─ ${title} ${rule}╮`));
    for (const [label, value] of rows) {
        const room = inner - 2 - 21;
        const clipped =
            width(value) > room ? truncate(value, room, 'start') : value;
        const line = `${pad(dim(label), 20)} ${clipped}`;
        console.log(`${dim('│')} ${pad(line, inner - 2)} ${dim('│')}`);
    }
    console.log(dim(`╰${'─'.repeat(inner)}╯`));
}

/** Prints the numbered next steps. */
export function nextSteps(steps: readonly string[]): void {
    console.log('');
    console.log(bold('Next steps'));
    for (const step of steps) {
        console.log(`  ${cyan('›')} ${step}`);
    }
    console.log('');
}

/** One option in a picker. */
export interface Choice {
    /** Value returned when picked. */
    value: string;
    /** Shown on the row. */
    label: string;
    /** Shown under the label, dimmed. */
    hint?: string;
    /** Starts ticked (multi-select) or focused (single-select). */
    selected?: boolean;
    /** Rendered greyed out and skipped by the cursor. */
    disabled?: boolean;
    /**
     * Always in the result, shown ticked but unselectable.
     *
     * Distinct from `disabled`, which means "cannot be had". A locked row is
     * something you *do* get and cannot decline — REST, in the protocols
     * question — and showing it keeps the answer readable as a complete set
     * rather than a list of extras.
     */
    locked?: boolean;
}

/** Whether the pickers can run at all. */
export function interactive(): boolean {
    return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/**
 * Reads single keypresses until `handle` says it is done.
 *
 * Raw mode is what makes arrow keys and space work without Enter. The `finally`
 * restores it, because a process that exits while still in raw mode leaves the
 * user's terminal with no echo, and they have to type `reset` blind to get it
 * back.
 *
 * Listeners rather than `for await (const chunk of stdin)`, because an answered
 * picker leaves that loop early — and a Node stream iterator destroys its
 * stream when the loop is left early. The first picker would answer fine and
 * take stdin down with it, and the next one would paint its rows and then
 * reject with `AbortError: The operation was aborted` before the user could
 * press a key. The wizard asks four of these in a row, so the loop has to leave
 * stdin readable for the next one.
 */
async function readKeys(
    handle: (key: string) => 'continue' | 'done' | 'cancel'
): Promise<'done' | 'cancel'> {
    const { stdin } = process;
    const wasRaw = stdin.isRaw;

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    try {
        return await new Promise<'done' | 'cancel'>((resolve, reject) => {
            const stop = (): void => {
                stdin.off('data', onData);
                stdin.off('end', onEnd);
                stdin.off('error', onError);
            };
            const onData = (chunk: string): void => {
                const outcome = handle(String(chunk));
                if (outcome === 'continue') return;
                stop();
                resolve(outcome);
            };
            // Only reachable when stdin is not a terminal, since Ctrl-D in raw
            // mode is a keypress rather than end-of-input. Treated as a cancel:
            // there is no one left to answer with.
            const onEnd = (): void => {
                stop();
                resolve('cancel');
            };
            const onError = (cause: Error): void => {
                stop();
                reject(cause);
            };

            stdin.on('data', onData);
            stdin.on('end', onEnd);
            stdin.on('error', onError);
        });
    } finally {
        stdin.setRawMode(wasRaw === true);
        stdin.pause();
    }
}

const UP = [`${CSI}A`, 'k'];
const DOWN = [`${CSI}B`, 'j'];
const ENTER = ['\r', '\n'];
/** Ctrl-C and Escape. */
const CANCEL = ['\u0003', ESC];

/** Moves `cursor` by `step`, skipping disabled rows and wrapping. */
function advance(
    choices: readonly Choice[],
    cursor: number,
    step: number
): number {
    let next = cursor;
    for (let i = 0; i < choices.length; i += 1) {
        next = (next + step + choices.length) % choices.length;
        const choice = choices[next];
        if (choice && !choice.disabled && !choice.locked) return next;
    }
    return cursor;
}

/** Rewrites the picker in place, returning how many lines it painted. */
function repaint(lines: readonly string[], previous: number): number {
    if (previous > 0) process.stdout.write(`${CSI}${previous}A`);
    for (const line of lines) {
        process.stdout.write(`${CSI}2K${line}\n`);
    }
    return lines.length;
}

/**
 * A single-choice picker. Returns the chosen value, or `undefined` if the user
 * cancelled with Escape or Ctrl-C.
 */
export async function select(
    label: string,
    choices: readonly Choice[]
): Promise<string | undefined> {
    let cursor = choices.findIndex((choice) => !choice.disabled);
    if (cursor === -1) return undefined;

    const initial = choices.findIndex((choice) => choice.selected);
    if (initial !== -1 && !choices[initial]?.disabled) cursor = initial;

    let painted = 0;
    const paint = (): void => {
        painted = repaint(
            [
                `${cyan('◆')} ${bold(label)}`,
                ...choices.flatMap((choice, index) => {
                    const focused = index === cursor;
                    const marker = choice.disabled
                        ? dim('○')
                        : focused
                          ? green('●')
                          : '○';
                    const text = choice.disabled
                        ? dim(`${choice.label} (unavailable)`)
                        : focused
                          ? bold(choice.label)
                          : choice.label;
                    return [
                        `  ${marker} ${text}`,
                        ...(choice.hint ? [`    ${dim(choice.hint)}`] : [])
                    ];
                }),
                dim('  ↑↓ move · enter select')
            ],
            painted
        );
    };

    paint();

    const outcome = await readKeys((key) => {
        if (CANCEL.includes(key)) return 'cancel';
        if (ENTER.includes(key)) return 'done';
        if (UP.includes(key)) cursor = advance(choices, cursor, -1);
        else if (DOWN.includes(key)) cursor = advance(choices, cursor, 1);
        else return 'continue';
        paint();
        return 'continue';
    });

    return outcome === 'done' ? choices[cursor]?.value : undefined;
}

/**
 * A checkbox picker. Returns the ticked values — an empty array is a valid
 * answer, and for the copilot providers it is the meaningful default.
 *
 * `undefined` means cancelled.
 */
export async function multiselect(
    label: string,
    choices: readonly Choice[]
): Promise<string[] | undefined> {
    const ticked = new Set(
        choices
            .filter(
                (choice) =>
                    (choice.selected || choice.locked) && !choice.disabled
            )
            .map((choice) => choice.value)
    );
    let cursor = choices.findIndex(
        (choice) => !choice.disabled && !choice.locked
    );
    // Every row is locked or unavailable: there is nothing to ask, so answer
    // with what is already ticked rather than painting a picker nobody can move.
    if (cursor === -1) return [...ticked];

    let painted = 0;
    const paint = (): void => {
        painted = repaint(
            [
                `${cyan('◆')} ${bold(label)}`,
                ...choices.flatMap((choice, index) => {
                    const focused = index === cursor;
                    const box = choice.disabled
                        ? dim('[ ]')
                        : choice.locked
                          ? dim('[x]')
                          : ticked.has(choice.value)
                            ? green('[x]')
                            : '[ ]';
                    const text = choice.disabled
                        ? dim(`${choice.label} (unavailable)`)
                        : choice.locked
                          ? dim(`${choice.label} (always on)`)
                          : focused
                            ? bold(choice.label)
                            : choice.label;
                    const pointer =
                        focused && !choice.disabled && !choice.locked
                            ? cyan('›')
                            : ' ';
                    return [
                        `  ${pointer} ${box} ${text}`,
                        ...(choice.hint ? [`      ${dim(choice.hint)}`] : [])
                    ];
                }),
                dim('  ↑↓ move · space toggle · enter confirm · none is fine')
            ],
            painted
        );
    };

    paint();

    const outcome = await readKeys((key) => {
        if (CANCEL.includes(key)) return 'cancel';
        if (ENTER.includes(key)) return 'done';
        if (UP.includes(key)) cursor = advance(choices, cursor, -1);
        else if (DOWN.includes(key)) cursor = advance(choices, cursor, 1);
        else if (key === ' ') {
            const choice = choices[cursor];
            if (choice && !choice.disabled && !choice.locked) {
                if (ticked.has(choice.value)) ticked.delete(choice.value);
                else ticked.add(choice.value);
            }
        } else return 'continue';
        paint();
        return 'continue';
    });

    return outcome === 'done' ? [...ticked] : undefined;
}
