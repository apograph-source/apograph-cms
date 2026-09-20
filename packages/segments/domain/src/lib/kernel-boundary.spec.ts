import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { canRead } from './entry-access';
import { SEGMENT_KEY_PATTERN } from './validation';

/** This package's root — `packages/segments/domain`. */
const PACKAGE = join(__dirname, '..', '..');
/** The group's root — `packages/segments`. */
const GROUP = join(PACKAGE, '..');

/** Every `.ts` file under a directory, specs excluded. */
function sources(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) return sources(path);
        if (!/\.tsx?$/.test(name)) return [];
        if (/\.spec\.tsx?$/.test(name)) return [];
        return [path];
    });
}

/** Every module specifier a file imports from. */
function imports(path: string): string[] {
    const text = readFileSync(path, 'utf-8');
    return [...text.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
}

/**
 * The two consumers the field rules exist to keep in step: the form somebody
 * types into and the DTO that answers them.
 */
const CONSUMERS = {
    'the server DTO': join(GROUP, 'server/src/lib/http/segments.dto.ts'),
    'the admin form': join(
        GROUP,
        'admin/src/lib/presentation/pages/SegmentEditorPage/index.tsx'
    )
};

describe('@orthacms/segments-domain is dependency-free', () => {
    /**
     * The kernel is the one place both a React form and a NestJS DTO can read
     * from, and that is only true while it needs neither of their worlds. A
     * dependency here is not a weight problem — it is the moment the admin
     * bundle starts pulling in whatever the server needed, or the rules stop
     * being shareable and get copied instead.
     */
    it('declares no dependencies at all [segments:I-38]', () => {
        const manifest = JSON.parse(
            readFileSync(join(PACKAGE, 'package.json'), 'utf-8')
        );

        for (const field of [
            'dependencies',
            'peerDependencies',
            'optionalDependencies',
            'devDependencies'
        ]) {
            expect(manifest[field] ?? {}).toEqual({});
        }
    });

    it('imports nothing outside its own files [segments:I-38]', () => {
        // The manifest above is a claim; this is the thing that would make it
        // false. A bare specifier here is a dependency the package does not
        // declare — which resolves in this workspace and breaks the moment
        // anybody installs it from npm.
        const foreign = sources(join(PACKAGE, 'src')).flatMap((path) =>
            imports(path)
                .filter((specifier) => !specifier.startsWith('.'))
                .map((specifier) => `${path}: ${specifier}`)
        );

        expect(foreign).toEqual([]);
    });
});

describe('the audience field rules have one home', () => {
    /**
     * Two copies of a validation rule is two copies to drift, and the way it
     * surfaces is the worst one available: a form that accepts what the API
     * then refuses, with the refusal arriving as a 400 written for a different
     * audience.
     */
    it.each(Object.entries(CONSUMERS))(
        '%s reads the limits from the kernel [segments:I-38]',
        (_name, path) => {
            const text = readFileSync(path, 'utf-8');

            expect(text).toContain("from '@orthacms/segments-domain'");
            for (const constant of [
                'SEGMENT_KEY_MAX',
                'SEGMENT_LABEL_MAX',
                'SEGMENT_TAG_MAX',
                'SEGMENT_TAGS_MAX'
            ]) {
                expect(text).toContain(constant);
            }
        }
    );

    it.each(Object.entries(CONSUMERS))(
        '%s does not restate the key pattern [segments:I-38]',
        (_name, path) => {
            // The pattern is also the default reader tag, so a second copy that
            // drifts wider does not merely accept a bad key — it mints a segment
            // whose tag nobody's resolver will ever produce, matching nobody.
            expect(readFileSync(path, 'utf-8')).not.toContain(
                SEGMENT_KEY_PATTERN.source
            );
        }
    );
});

/**
 * That the **reader** decision never asks where an audience is offered.
 *
 * `isOfferedIn(segment, workspaceId)` answers an editor's question: may this
 * workspace put this audience on an entry. Folding it into `canRead` would make
 * a published page's visibility depend on the workspace scoping of the audience
 * that gated it — so scoping an audience away from a workspace, an editorial
 * housekeeping act, would silently republish every entry that audience was
 * keeping private.
 *
 * A judgment once retired this as unreachable, on the grounds that `canRead` is
 * handed neither a workspace nor the catalogue so nothing a test can vary would
 * show it. That is the right observation and the wrong conclusion: it makes the
 * statement *structural*, not unobservable, and this package already asserts
 * structure — the import scan above is the same shape. Both halves are checked
 * here, because they defend each other: the signature is what makes an inlined
 * offering check impossible, and the absent import is what makes a delegated
 * one impossible.
 */
describe('the reader decision is not the editor’s', () => {
    /** Where `canRead` lives, and where `isOfferedIn` lives. */
    const READER = join(PACKAGE, 'src/lib/entry-access.ts');

    it('takes the entry’s lists and the reader’s segments, and nothing else [segments:I-09]', () => {
        // Two parameters, both about the reader and the row. There is no third
        // to smuggle a workspace or a segment catalogue in through, which is
        // what makes the rule hold by construction rather than by discipline.
        expect(canRead.length).toBe(2);
        expect(canRead({ allow: ['acme'], deny: [] }, new Set(['acme']))).toBe(
            true
        );
    });

    it('is written in a module that imports nothing at all [segments:I-09]', () => {
        // `isOfferedIn` lives in `./segment`. An import here is the only way
        // `canRead` could reach it, so an empty import list is the assertion —
        // and it fails on the natural way to break the rule, which is to reach
        // for the helper rather than to re-derive it.
        expect(imports(READER)).toEqual([]);
        expect(readFileSync(READER, 'utf-8')).not.toContain('isOfferedIn');
    });
});
