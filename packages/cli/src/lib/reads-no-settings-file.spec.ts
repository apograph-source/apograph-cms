import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * The other half of `cli:I-22` — "the CLI reads no settings file of its own".
 *
 * `layout-is-convention.spec.ts` pins the first half by enumerating *string
 * literals*, because a second opinion about where the server compiles to has to
 * be spelled out to be used. That approach cannot pin this half, and the
 * judgment file recorded it as an unbounded absence for exactly that reason: a
 * settings read need not name its file inline, so `readFileSync(join(root,
 * name))` slips past any literal scan.
 *
 * The observable was chosen badly, not missing. A read has to *happen* through
 * a filesystem API, and there are twelve such call sites in the whole package.
 * Enumerating **call sites** rather than paths is bounded, and it is
 * indifferent to how the path was computed: a new read is caught whether it
 * names its file, joins it, or receives it as an argument.
 *
 * Two assertions hold the enumeration honest:
 *
 * - the reading APIs the package imports are a fixed set, so a read cannot
 *   arrive through an identifier the site scan does not look for (an alias, a
 *   promises handle, a namespace import);
 * - the twelve sites are listed here in full, each one a `.env`, a
 *   `package.json`, or a path out of `LAYOUT`. None is a settings file, and a
 *   thirteenth cannot appear without this list being edited to admit it.
 */

/** The package root — `packages/cli`. */
const PACKAGE = join(__dirname, '..', '..');

/** Every shipped `.ts` under `src/`, specs excluded. */
function sources(dir = join(PACKAGE, 'src')): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) return sources(path);
        if (!path.endsWith('.ts') || path.endsWith('.spec.ts')) return [];
        return [path];
    });
}

/** A file's source with comments removed — prose mentions are not code. */
function code(path: string): string {
    return readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
}

/** `packages/cli`-relative, POSIX-spelled, so the table reads the same on Windows. */
function name(path: string): string {
    return relative(PACKAGE, path).split(sep).join('/');
}

/**
 * The APIs that can put the contents — or the existence — of a file into the
 * CLI's hands. `createRequire` and `loadEnvFile` are reads too: one pulls in the
 * compiled config and a dependency's manifest, the other parses `.env`.
 */
const READERS = [
    'readFileSync',
    'readFile',
    'readdirSync',
    'readdir',
    'statSync',
    'existsSync',
    'openSync',
    'opendirSync',
    'createReadStream',
    'loadEnvFile',
    'createRequire'
] as const;

/** Every `NAME(…)` call for one of {@link READERS}, with its argument text. */
function readSites(path: string): string[] {
    const source = code(path);
    const call = new RegExp(`\\b(?:process\\.)?(${READERS.join('|')})\\(`, 'g');
    const sites: string[] = [];

    for (const match of source.matchAll(call)) {
        let depth = 1;
        let index = match.index + match[0].length;
        const start = index;

        while (index < source.length && depth > 0) {
            if (source[index] === '(') depth += 1;
            else if (source[index] === ')') depth -= 1;
            index += 1;
        }

        const args = source
            .slice(start, index - 1)
            .replace(/\s+/g, ' ')
            .trim();
        sites.push(`${name(path)}: ${match[1]}(${args})`);
    }

    return sites;
}

/**
 * Every filesystem read the CLI performs, and what each one reaches for.
 *
 * `.env` is environment, not layout, and `package.json` is npm's own file —
 * neither is a place the CLI could be told where the app lives. Everything else
 * resolves through `LAYOUT`, which is the point of the invariant.
 */
const EXPECTED_READS = [
    // `.env` — the app's environment, loaded once at startup.
    'src/lib/env.ts: existsSync(envFile)',
    'src/lib/env.ts: loadEnvFile(envFile)',
    // `package.json` — root discovery, and the require base for the compiled host.
    "src/lib/project.ts: existsSync(join(dir, 'package.json'))",
    // `configPath` / `pluginsPath`, both `join(root, LAYOUT.compiled*)`.
    'src/lib/project.ts: existsSync(path)',
    "src/lib/project.ts: createRequire(join(root, 'package.json'))",
    // A dependency's own manifest, for its `bin` field.
    "src/lib/run.ts: createRequire(join(root, 'package.json'))",
    "src/lib/run.ts: readFileSync(manifestPath, 'utf8')",
    // This package's manifest, for `ortha --version`.
    "src/lib/version.ts: readFileSync(manifest, 'utf8')",
    // The rest are `LAYOUT` paths: the admin entry, the drizzle config, the server bundle.
    'src/lib/commands/build.ts: existsSync(join(root, LAYOUT.adminIndex))',
    'src/lib/commands/dev.ts: existsSync(join(root, LAYOUT.adminIndex))',
    'src/lib/commands/generate.ts: existsSync(join(root, LAYOUT.drizzleConfig))',
    'src/lib/commands/start.ts: existsSync(entry)'
];

describe('the CLI reads no settings file of its own', () => {
    it('imports only the reading APIs this scan looks for [cli:I-22]', () => {
        // The premise the site enumeration rests on. A namespace import
        // (`import * as fs`), a promises handle, or an alias would let a read
        // happen under a name the scan below never matches, so the set of
        // identifiers the package pulls out of `node:fs` / `node:module` is
        // itself pinned.
        const imported = new Set<string>();

        for (const path of sources()) {
            for (const match of code(path).matchAll(
                /import\s+([^;]+?)\s+from\s+'node:(fs|fs\/promises|module)'/g
            )) {
                const clause = match[1].trim();
                expect(clause.startsWith('{')).toBe(true);
                for (const part of clause.replace(/[{}]/g, '').split(','))
                    if (part.trim()) imported.add(part.trim());
            }
        }

        // Writes are the CLI's own scratch files (Studio's temp config); the
        // reads are what this spec is about, and they are all in READERS.
        const reads = [...imported].filter(
            (id) => !/^(mkdtempSync|rmSync|writeFileSync|mkdirSync)$/.test(id)
        );

        expect(reads.length).toBeGreaterThan(0);
        for (const id of reads)
            expect(READERS as readonly string[]).toContain(id);
    });

    it('performs exactly these twelve reads, none of them a settings file [cli:I-22]', () => {
        const files = sources();
        // Guard against the scan silently finding nothing and passing.
        expect(files.length).toBeGreaterThan(5);

        const actual = files.flatMap(readSites);

        expect(actual.length).toBeGreaterThan(0);
        expect([...actual].sort()).toEqual([...EXPECTED_READS].sort());
    });
});
