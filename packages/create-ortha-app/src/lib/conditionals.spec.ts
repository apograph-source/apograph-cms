import { applyConditionals } from './conditionals';

/** Applies `source` with `flags` on, trimming for readable assertions. */
function apply(source: string, ...flags: string[]): string {
    return applyConditionals(source, new Set(flags)).trim();
}

describe('applyConditionals', () => {
    it('keeps a block whose flag is on, without its markers [create-ortha-app:I-09]', () => {
        const source = [
            'before',
            '// ortha:if copilot',
            'kept',
            '// ortha:end',
            'after'
        ].join('\n');

        expect(apply(source, 'copilot')).toBe('before\nkept\nafter');
    });

    it('drops a block whose flag is off [create-ortha-app:I-09]', () => {
        const source = [
            'before',
            '// ortha:if copilot',
            'dropped',
            '// ortha:end',
            'after'
        ].join('\n');

        expect(apply(source)).toBe('before\nafter');
    });

    it('inverts with ifnot', () => {
        const source = [
            '# ortha:ifnot graphql',
            'REST only',
            '# ortha:end'
        ].join('\n');

        expect(apply(source)).toBe('REST only');
        expect(apply(source, 'graphql')).toBe('');
    });

    /** The same directive has to work in TS, YAML, .env and Markdown. */
    it.each([
        ['//', '// ortha:if x', '// ortha:end'],
        ['#', '# ortha:if x', '# ortha:end'],
        ['block comment', '/* ortha:if x */', '/* ortha:end */'],
        ['indented', '    // ortha:if x', '    // ortha:end']
    ])('recognises the %s style', (_label, open, close) => {
        expect(apply([open, 'body', close].join('\n'), 'x')).toBe('body');
        expect(apply([open, 'body', close].join('\n'))).toBe('');
    });

    it('nests, and an inner block inside a dropped one stays dropped [create-ortha-app:I-08]', () => {
        const source = [
            '// ortha:if copilot',
            'outer',
            '// ortha:if copilot-openai',
            'inner',
            '// ortha:end',
            '// ortha:end'
        ].join('\n');

        expect(apply(source, 'copilot', 'copilot-openai')).toBe('outer\ninner');
        expect(apply(source, 'copilot')).toBe('outer');
        // The inner flag is on, but its parent is not — it must not leak out.
        expect(apply(source, 'copilot-openai')).toBe('');
    });

    it('handles several independent blocks in one file', () => {
        const source = [
            '// ortha:if a',
            'A',
            '// ortha:end',
            '// ortha:if b',
            'B',
            '// ortha:end'
        ].join('\n');

        expect(apply(source, 'b')).toBe('B');
    });

    it('leaves a file with no directives untouched', () => {
        expect(apply('just\ncode')).toBe('just\ncode');
    });

    it('collapses the blank-line scar a removed block leaves behind', () => {
        const source = [
            'before',
            '',
            '// ortha:if off',
            'dropped',
            '// ortha:end',
            '',
            'after'
        ].join('\n');

        expect(apply(source)).toBe('before\n\nafter');
    });

    /**
     * The failure this guard exists for: a missing `ortha:end` in `plugins.ts`
     * silently deletes every plugin below it, and the app boots with no API
     * rather than failing to render.
     */
    it('throws on an unclosed block rather than swallowing the rest [create-ortha-app:I-07]', () => {
        expect(() =>
            applyConditionals(
                '// ortha:if copilot\nbody\nmore',
                new Set(),
                'plugins.ts'
            )
        ).toThrow(/unclosed/);
    });

    it('names the file in that error [create-ortha-app:I-07]', () => {
        expect(() =>
            applyConditionals('// ortha:if x\n', new Set(), 'plugins.ts')
        ).toThrow(/plugins\.ts/);
    });

    it('throws on a stray end [create-ortha-app:I-07]', () => {
        expect(() =>
            applyConditionals('// ortha:end\n', new Set(), 'env.tmpl')
        ).toThrow(/no matching/);
    });

    it('does not treat a mention in prose as a directive', () => {
        const source = 'Use ortha:if copilot blocks to branch the template.';

        expect(apply(source)).toBe(source);
    });
});
