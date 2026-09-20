import { McpPlugin } from './mcp-plugin';

const CONFIG = {
    enabled: true,
    name: 'ortha-cms',
    version: '1.0.0',
    callTimeoutMs: 30_000,
    maxResultBytes: 4_194_304
};

describe('McpPlugin', () => {
    it('builds a named plugin carrying its config', () => {
        const plugin = McpPlugin({ config: CONFIG });

        expect(plugin.name).toBe('mcp');
        expect(plugin.mcpConfig).toEqual(CONFIG);
        expect(plugin.module).toBeDefined();
    });

    it('owns no migrations [mcp:I-21]', () => {
        expect(McpPlugin({ config: CONFIG }).migrations).toBeUndefined();
    });

    it('builds when disabled — the registry still binds', () => {
        const plugin = McpPlugin({
            config: { ...CONFIG, enabled: false }
        });

        expect(plugin.mcpConfig.enabled).toBe(false);
    });

    // Eager, like every other plugin factory here: a blank identity would
    // surface as a malformed `initialize` response, far from its cause.
    it('rejects a blank server name at construction', () => {
        expect(() => McpPlugin({ config: { ...CONFIG, name: '' } })).toThrow(
            /config\.name/
        );
    });

    it('rejects a blank version at construction', () => {
        expect(() => McpPlugin({ config: { ...CONFIG, version: '' } })).toThrow(
            /config\.version/
        );
    });

    // `Number(process.env[…]) || default` hides a typo behind the default, so
    // the only shapes that reach here are ones someone wrote on purpose — and
    // a zero deadline would fail every call with nothing to explain it.
    it.each([
        ['callTimeoutMs', 0],
        ['callTimeoutMs', -1],
        ['callTimeoutMs', Number.NaN],
        ['callTimeoutMs', 1.5],
        ['maxResultBytes', 0],
        ['maxResultBytes', -1],
        ['maxResultBytes', Number.NaN]
    ])('rejects a non-positive %s (%p) at construction', (field, value) => {
        expect(() =>
            McpPlugin({ config: { ...CONFIG, [field]: value } })
        ).toThrow(new RegExp(`config\\.${field}`));
    });
});
