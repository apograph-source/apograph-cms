import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * No transport crosses the tool contract.
 *
 * The dossier used to state this as "no type and no function in the package
 * mentions HTTP, JSON-RPC or MCP", which the code contradicts outright: refusals
 * are Nest `HttpException`s, `ToolError.status` is a number documented as
 * HTTP-ish, and `ToolSurface` is literally `'mcp' | 'copilot'`. It was recorded
 * `stale` in the ledger and the dossier now says what actually holds, which is
 * narrower and load-bearing in a way the old wording was not:
 *
 * - **JSON-RPC does not appear at all.** It is MCP's wire format, and the
 *   copilot's run loop speaks none of it. A `-32602` or a `jsonrpc` field
 *   reaching this package would be one consumer's framing leaking into the
 *   catalogue both of them share.
 * - **No request or response object reaches a handler.** `ToolContext` is the
 *   entire world a tool sees, and the fields it carries are all answers —
 *   who is calling, where, may they — rather than a channel to ask down.
 *
 * `surface` is the deliberate exception and stays presentation-only, which
 * `surface-is-presentation.spec.ts` pins.
 */

/** The package's `src/` directory. */
const SRC = __dirname;

/** Every shipped `.ts` under `src/`, specs excluded. */
function sources(dir = SRC): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) return sources(path);
        if (!path.endsWith('.ts') || path.endsWith('.spec.ts')) return [];
        return [path];
    });
}

/** A file's code with comments removed, so prose about a rule is not the rule. */
function code(path: string): string {
    return readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line))
        .join('\n');
}

/** Source files whose code matches, relative to `src/`. */
function matching(pattern: RegExp): string[] {
    return sources()
        .filter((path) => pattern.test(code(path)))
        .map((path) => relative(SRC, path));
}

describe('the tool contract is transport-neutral', () => {
    it('speaks no JSON-RPC [tools:I-25]', () => {
        // The vocabulary, not the acronym: a `jsonrpc` envelope field, a
        // `method`/`params` pair as a type, or one of the reserved error codes.
        // Comments are stripped first — `tool-registry.ts` discusses this very
        // rule in prose and must go on being able to.
        expect(matching(/jsonrpc|json-rpc/i)).toEqual([]);
        expect(matching(/-32\d{3}/)).toEqual([]);
    });

    it('imports no HTTP transport [tools:I-25]', () => {
        // `@nestjs/common` is here for DI and the exception classes, which are
        // the flattening path `ToolError` documents. A platform adapter, or
        // node's own `http`, would be something else entirely: a package that
        // could read a header.
        expect(
            matching(/from '(express|node:http|http|@nestjs\/platform-[a-z]+)'/)
        ).toEqual([]);
    });

    it('hands a handler answers rather than a channel [tools:I-25]', () => {
        // `ToolContext` is the whole world a tool sees, so its field list is
        // the contract this invariant is about. Every entry is a resolved fact;
        // adding a `req`, a `res`, a `headers` bag — or the raw JSON-RPC frame
        // an MCP adapter is holding anyway — lands here.
        const contract = code(join(SRC, 'lib', 'tool.ts'));
        const body = contract.match(
            /export interface ToolContext \{([\s\S]*?)\n\}/
        );
        expect(body).not.toBeNull();

        const fields = [
            ...(body?.[1] ?? '').matchAll(/^\s{4}([a-zA-Z]+)\??[:(]/gm)
        ].map(([, name]) => name);

        expect(fields.sort()).toEqual([
            'actor',
            'can',
            'signal',
            'surface',
            'workspaceId'
        ]);
    });
});
