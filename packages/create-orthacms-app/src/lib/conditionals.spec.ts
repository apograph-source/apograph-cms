import { applyConditionals } from './conditionals';

/** Applies `source` with `flags` on, trimming for readable assertions. */
function apply(source: string, ...flags: string[]): string {
    return applyConditionals(source, new Set(flags)).trim();
}

describe('applyConditionals', () => {
    it('keeps a block whose flag is on, without its markers [create-orthacms-app:I-09]', () => {
        const source = [
            'before',
            '// orthacms:if copilot',
            'kept',
            '// orthacms:end',
            'after'
        ].join('\n');

        expect(apply(source, 'copilot')).toBe('before\nkept\nafter');
    });

    it('drops a block whose flag is off [create-orthacms-app:I-09]', () => {
        const source = [
            'before',
            '// orthacms:if copilot',
            'dropped',
            '// orthacms:end',
            'after'
        ].join('\n');

        expect(apply(source)).toBe('before\nafter');
    });

    it('inverts with ifnot', () => {
        const source = [
            '# orthacms:ifnot graphql',
            'REST only',
            '# orthacms:end'
        ].join('\n');

        expect(apply(source)).toBe('REST only');
        expect(apply(source, 'graphql')).toBe('');
    });

    /** The same directive has to work in TS, YAML, .env and Markdown. */
    it.each([
        ['//', '// orthacms:if x', '// orthacms:end'],
        ['#', '# orthacms:if x', '# orthacms:end'],
        ['block comment', '/* orthacms:if x */', '/* orthacms:end */'],
        ['indented', '    // orthacms:if x', '    // orthacms:end']
    ])('recognises the %s style', (_label, open, close) => {
        expect(apply([open, 'body', close].join('\n'), 'x')).toBe('body');
        expect(apply([open, 'body', close].join('\n'))).toBe('');
    });

    it('nests, and an inner block inside a dropped one stays dropped [create-orthacms-app:I-08]', () => {
        const source = [
            '// orthacms:if copilot',
            'outer',
            '// orthacms:if copilot-openai',
            'inner',
            '// orthacms:end',
            '// orthacms:end'
        ].join('\n');

        expect(apply(source, 'copilot', 'copilot-openai')).toBe('outer\ninner');
        expect(apply(source, 'copilot')).toBe('outer');
        // The inner flag is on, but its parent is not — it must not leak out.
        expect(apply(source, 'copilot-openai')).toBe('');
    });

    it('handles several independent blocks in one file', () => {
        const source = [
            '// orthacms:if a',
            'A',
            '// orthacms:end',
            '// orthacms:if b',
            'B',
            '// orthacms:end'
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
            '// orthacms:if off',
            'dropped',
            '// orthacms:end',
            '',
            'after'
        ].join('\n');

        expect(apply(source)).toBe('before\n\nafter');
    });

    /**
     * The failure this guard exists for: a missing `orthacms:end` in `plugins.ts`
     * silently deletes every plugin below it, and the app boots with no API
     * rather than failing to render.
     */
    it('throws on an unclosed block rather than swallowing the rest [create-orthacms-app:I-07]', () => {
        expect(() =>
            applyConditionals(
                '// orthacms:if copilot\nbody\nmore',
                new Set(),
                'plugins.ts'
            )
        ).toThrow(/unclosed/);
    });

    it('names the file in that error [create-orthacms-app:I-07]', () => {
        expect(() =>
            applyConditionals('// orthacms:if x\n', new Set(), 'plugins.ts')
        ).toThrow(/plugins\.ts/);
    });

    it('throws on a stray end [create-orthacms-app:I-07]', () => {
        expect(() =>
            applyConditionals('// orthacms:end\n', new Set(), 'env.tmpl')
        ).toThrow(/no matching/);
    });

    it('does not treat a mention in prose as a directive', () => {
        const source = 'Use orthacms:if copilot blocks to branch the template.';

        expect(apply(source)).toBe(source);
    });
});
