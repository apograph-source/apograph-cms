import { applyConditionals } from './conditionals';

/** Applies `source` with `flags` on, trimming for readable assertions. */
function apply(source: string, ...flags: string[]): string {
    return applyConditionals(source, new Set(flags)).trim();
}

describe('applyConditionals', () => {
    it('keeps a block whose flag is on, without its markers [create-apograph-app:I-09]', () => {
        const source = [
            'before',
            '// apograph:if copilot',
            'kept',
            '// apograph:end',
            'after'
        ].join('\n');

        expect(apply(source, 'copilot')).toBe('before\nkept\nafter');
    });

    it('drops a block whose flag is off [create-apograph-app:I-09]', () => {
        const source = [
            'before',
            '// apograph:if copilot',
            'dropped',
            '// apograph:end',
            'after'
        ].join('\n');

        expect(apply(source)).toBe('before\nafter');
    });

    it('inverts with ifnot', () => {
        const source = [
            '# apograph:ifnot graphql',
            'REST only',
            '# apograph:end'
        ].join('\n');

        expect(apply(source)).toBe('REST only');
        expect(apply(source, 'graphql')).toBe('');
    });

    /** The same directive has to work in TS, YAML, .env and Markdown. */
    it.each([
        ['//', '// apograph:if x', '// apograph:end'],
        ['#', '# apograph:if x', '# apograph:end'],
        ['block comment', '/* apograph:if x */', '/* apograph:end */'],
        ['indented', '    // apograph:if x', '    // apograph:end']
    ])('recognises the %s style', (_label, open, close) => {
        expect(apply([open, 'body', close].join('\n'), 'x')).toBe('body');
        expect(apply([open, 'body', close].join('\n'))).toBe('');
    });

    it('nests, and an inner block inside a dropped one stays dropped [create-apograph-app:I-08]', () => {
        const source = [
            '// apograph:if copilot',
            'outer',
            '// apograph:if copilot-openai',
            'inner',
            '// apograph:end',
            '// apograph:end'
        ].join('\n');

        expect(apply(source, 'copilot', 'copilot-openai')).toBe('outer\ninner');
        expect(apply(source, 'copilot')).toBe('outer');
        // The inner flag is on, but its parent is not — it must not leak out.
        expect(apply(source, 'copilot-openai')).toBe('');
    });

    it('handles several independent blocks in one file', () => {
        const source = [
            '// apograph:if a',
            'A',
            '// apograph:end',
            '// apograph:if b',
            'B',
            '// apograph:end'
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
            '// apograph:if off',
            'dropped',
            '// apograph:end',
            '',
            'after'
        ].join('\n');

        expect(apply(source)).toBe('before\n\nafter');
    });

    /**
     * The failure this guard exists for: a missing `apograph:end` in `plugins.ts`
     * silently deletes every plugin below it, and the app boots with no API
     * rather than failing to render.
     */
    it('throws on an unclosed block rather than swallowing the rest [create-apograph-app:I-07]', () => {
        expect(() =>
            applyConditionals(
                '// apograph:if copilot\nbody\nmore',
                new Set(),
                'plugins.ts'
            )
        ).toThrow(/unclosed/);
    });

    it('names the file in that error [create-apograph-app:I-07]', () => {
        expect(() =>
            applyConditionals('// apograph:if x\n', new Set(), 'plugins.ts')
        ).toThrow(/plugins\.ts/);
    });

    it('throws on a stray end [create-apograph-app:I-07]', () => {
        expect(() =>
            applyConditionals('// apograph:end\n', new Set(), 'env.tmpl')
        ).toThrow(/no matching/);
    });

    it('does not treat a mention in prose as a directive', () => {
        const source = 'Use apograph:if copilot blocks to branch the template.';

        expect(apply(source)).toBe(source);
    });
});
