import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TransferModule } from './transfer.module';
import { ExportEntriesController } from './export/http/controllers/export-entries.controller';
import { ImportEntriesController } from './import/http/controllers/import-entries.controller';

/** Nest's own key for `@Global()`, from `@nestjs/common/constants`. */
const GLOBAL_MODULE_METADATA = '__module:global__';

describe('TransferModule.forRoot', () => {
    const module = TransferModule.forRoot({});

    it('exports nothing and is not global [transfer:I-38]', () => {
        // The dependency arrow points only away from transfer: it reads
        // content's registry and writer, media's storage, identity's
        // permissions — and nothing reads back into it. A provider exported
        // here, or a `@Global()` on the class, is how that becomes untrue
        // without anybody deciding it should.
        expect(module.exports).toBeUndefined();
        expect(module.global).toBeFalsy();
        expect(
            Reflect.getMetadata(GLOBAL_MODULE_METADATA, TransferModule)
        ).toBeFalsy();
        expect(module.module).toBe(TransferModule);
    });

    it('still provides the things it keeps to itself', () => {
        // Guards the assertion above: a module that provided nothing would
        // also export nothing, and would prove nothing by it.
        expect(module.providers?.length).toBeGreaterThan(5);
        expect(module.controllers).toEqual([
            ExportEntriesController,
            ImportEntriesController
        ]);
    });
});

describe('nothing in the workspace imports transfer [transfer:I-38]', () => {
    // `src/lib` → `src` → `server` → `transfer` → `packages`.
    const PACKAGES = join(__dirname, '..', '..', '..', '..');
    const TRANSFER = join(PACKAGES, 'transfer');
    /**
     * The scaffolder's templates are a **host**, not a package.
     * `templates/default/apps/server/src/plugins.ts` is rendered into a new
     * app's own composition root, which is the exception this rule already
     * makes for `apps/`; it only lands under `packages/` because that is where
     * the scaffolder lives. Excluding it by path keeps the rule about the
     * package graph, which is what it is for.
     */
    const TEMPLATES = join(PACKAGES, 'create-orthacms-app', 'templates');

    /** Every non-spec `.ts`/`.tsx` source under `packages/`, less transfer's own. */
    function sourceFiles(dir: string): string[] {
        return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                // Build output and installed dependencies are not sources.
                if (
                    entry.name === 'node_modules' ||
                    entry.name === 'dist' ||
                    entry.name === 'out-tsc' ||
                    entry.name === 'test-output'
                ) {
                    return [];
                }
                if (path === TRANSFER || path === TEMPLATES) return [];
                return sourceFiles(path);
            }
            if (
                !/\.tsx?$/.test(entry.name) ||
                /\.spec\.tsx?$/.test(entry.name)
            ) {
                return [];
            }
            return [path];
        });
    }

    const FILES = sourceFiles(PACKAGES);

    it('found the sibling packages to check', () => {
        expect(FILES.length).toBeGreaterThan(200);
        expect(
            FILES.some((path) =>
                path.endsWith(join('content', 'server', 'src', 'index.ts'))
            )
        ).toBe(true);
    });

    it('has no importer outside its own group', () => {
        // Apps are the exception by design — a host composes the plugin list,
        // and `apps/server/src/plugins.ts` names it, as does the scaffolder
        // template that becomes one. What must stay empty is the package
        // graph: an arrow back from a sibling package is a cycle, and it is
        // the reason this module exports nothing to make one with.
        const importers = FILES.filter((path) =>
            /from\s+'@orthacms\/transfer-/.test(readFileSync(path, 'utf8'))
        ).map((path) => path.slice(PACKAGES.length + 1));

        expect(importers).toEqual([]);
    });
});
