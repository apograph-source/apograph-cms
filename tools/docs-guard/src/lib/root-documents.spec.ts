import { asNumber, claimIn, numberClaimedIn, projectMapRows } from './claim';
import {
    contractFields,
    documentedContractFields,
    domainKernels,
    providerPackagesOf,
    slotIdsDefinedIn,
    tablesOwnedBy,
    workspaceProjects
} from './code';
import { readDocument, readRepoFile, readRepoSubdirectories } from './repo';

/**
 * The root documents are the first thing a new reader opens and the last thing
 * anyone remembers to update, so every claim here that is *countable* — how
 * many slots, how many contract fields, how many tables a plugin owns — is
 * derived from the code and compared, rather than re-read by a human.
 *
 * A claim that stops matching its pattern fails as loudly as a claim that
 * states the wrong number: silence would mean the guard had quietly stopped
 * pinning anything, which is the state this project exists to end.
 */
const ARCHITECTURE = 'ARCHITECTURE.md';
const CONTEXT_MAP = 'CONTEXT-MAP.md';
const ADR_0002 = 'docs/adr/0002-plugin-based-architecture.md';

const CONTENT_SLOTS =
    'packages/content/admin/src/lib/presentation/slots/contentSlots/index.ts';

describe('the Content Library slot count', () => {
    const ids = slotIdsDefinedIn(CONTENT_SLOTS);
    const under = (prefix: string) =>
        ids.filter((id) => id === prefix || id.startsWith(`${prefix}.`)).length;

    const groups = {
        records: under('content.records'),
        entry: under('content.entry'),
        revision: under('content.revision'),
        overlay: under('content.overlay')
    };

    it('is the number of slots the module defines', () => {
        expect(
            numberClaimedIn(ARCHITECTURE, /defines \*\*(\d+)\*\* of its own — /)
        ).toBe(ids.length);
        expect(
            numberClaimedIn(
                CONTEXT_MAP,
                /Defines \*\*(\d+)\*\* extension slots — /
            )
        ).toBe(ids.length);
    });

    it('accounts for every slot in one of the four groups', () => {
        // A fifth family of slot ids fails here rather than going undescribed
        // while both totals still add up.
        expect(
            groups.records + groups.entry + groups.revision + groups.overlay
        ).toBe(ids.length);
    });

    it.each([
        [
            ARCHITECTURE,
            /— (\w+) around the records list \(/,
            /, (\w+) around the entry editor \(/,
            /, (\w+) on the revision view and /,
            / and (\w+) route-level overlay/
        ],
        [
            CONTEXT_MAP,
            /— (\w+) around the records list \(/,
            /, (\w+) around the editor \(/,
            /, (\w+) on the revision view, /,
            /, (\w+) route-level overlay/
        ]
    ])(
        'breaks down the way the slot ids do in %s',
        (document, records, entry, revision, overlay) => {
            expect(numberClaimedIn(document, records)).toBe(groups.records);
            expect(numberClaimedIn(document, entry)).toBe(groups.entry);
            expect(numberClaimedIn(document, revision)).toBe(groups.revision);
            expect(numberClaimedIn(document, overlay)).toBe(groups.overlay);
        }
    );
});

describe('the plugin contracts ARCHITECTURE.md prints', () => {
    // Read raw, not collapsed: a code block is checked line by line, so it
    // is the one place the documents' hard wrapping carries meaning.
    const architecture = readRepoFile(ARCHITECTURE);

    it.each([
        [
            'ServerPlugin',
            'packages/bootstrap/server/src/lib/types/server-plugin.ts'
        ],
        [
            'AdminPlugin',
            'packages/bootstrap/admin/src/lib/types/adminPlugin/index.ts'
        ]
    ])('show every field of %s, in order, and only those', (name, source) => {
        expect(documentedContractFields(architecture, name)).toEqual(
            contractFields(source, name)
        );
    });
});

describe('the package-layout claims in ARCHITECTURE.md', () => {
    it('name every framework-free domain kernel', () => {
        const listed = claimIn(
            ARCHITECTURE,
            /find a framework-free `domain` kernel \(([^)]*)\)/
        )[0]
            .split(', ')
            .map((entry) => entry.replace(/`/g, ''))
            .sort();
        expect(listed).toEqual(domainKernels());
    });

    it('count the provider adapters each group ships', () => {
        const [media, identity, copilot] = claimIn(
            ARCHITECTURE,
            /`media` has (\w+) plus a shared contract test kit, `identity` (\w+), `copilot` (\w+)\./
        );
        // The test kit is a harness for writing a provider, not one of them —
        // hence the separate clause, and hence excluding it from the count.
        expect(providerPackagesOf('media')).toContain('provider-testkit');
        expect(asNumber(media)).toBe(
            providerPackagesOf('media').filter(
                (name) => name !== 'provider-testkit'
            ).length
        );
        expect(asNumber(identity)).toBe(providerPackagesOf('identity').length);
        expect(asNumber(copilot)).toBe(providerPackagesOf('copilot').length);
    });
});

describe('the tables the documents attribute to a plugin', () => {
    it('are the one `database` migrates — the single sanctioned exception', () => {
        const owned = tablesOwnedBy('packages/database');
        expect(owned).toEqual(['outbox_events']);
        expect(
            numberClaimedIn(
                ARCHITECTURE,
                /It owns exactly \*\*(\w+)\*\* table — `outbox_events`/
            )
        ).toBe(owned.length);
        expect(
            numberClaimedIn(
                CONTEXT_MAP,
                /Owns exactly \*\*(\w+)\*\* table — `outbox_events`/
            )
        ).toBe(owned.length);
        // ADR-0002 decided "no schema"; ADR-0003 amended it to this one table.
        // A second would be a new decision, not a documentation edit.
        expect(readDocument(ADR_0002)).toContain(
            'It remains the only table in this package'
        );
    });

    it.each([
        [
            'copilot/server',
            'packages/copilot/server',
            /and the (\w+) tables it owns and migrates\./
        ],
        [
            'workspaces/server',
            'packages/workspaces/server',
            /Owns those (\w+) tables and their migrations\./
        ],
        [
            'webhooks/server',
            'packages/webhooks/server',
            /Owns (\w+) tables\. Administrator-only\./
        ]
    ])('are counted right for %s', (_name, packageDir, pattern) => {
        expect(numberClaimedIn(CONTEXT_MAP, pattern)).toBe(
            tablesOwnedBy(packageDir).length
        );
    });

    it.each([
        [
            'i18n/server',
            'packages/i18n/server',
            /coverage.*?\)\. Owns no tables\./
        ],
        [
            'transfer/server',
            'packages/transfer/server',
            /Owns no tables; hand-rolls its ZIP container/
        ]
    ])('are none for %s', (_name, packageDir, pattern) => {
        claimIn(CONTEXT_MAP, pattern);
        expect(tablesOwnedBy(packageDir)).toEqual([]);
    });

    it('are named right for alarms/server', () => {
        const named = claimIn(
            CONTEXT_MAP,
            /Owns `(\w+)` \+ `(\w+)`; evaluates a rule/
        );
        expect([...named].sort()).toEqual(
            tablesOwnedBy('packages/alarms/server')
        );
    });

    it('are named right for the platform tables content/server ships', () => {
        const named = claimIn(
            ARCHITECTURE,
            /ships migrations only for its fixed platform tables \(`(\w+)`, `(\w+)`\)/
        );
        expect([...named].sort()).toEqual(
            tablesOwnedBy('packages/content/server')
        );
    });
});

describe("CONTEXT-MAP.md's project map", () => {
    const rows = projectMapRows(CONTEXT_MAP);
    const projects = workspaceProjects();

    it('lists every project the workspace ships, and no other', () => {
        expect(rows.map((row) => row.project).sort()).toEqual(
            projects.map((project) => project.path).sort()
        );
    });

    it('names each project by the name npm publishes it under', () => {
        const listed = new Map(
            rows.map((row) => [row.project, row.packageName])
        );
        for (const { path, packageName } of projects) {
            // An app or a tooling project has no published name; the column
            // holds an em dash rather than a blank, so the row still reads.
            expect(listed.get(path)).toBe(packageName ?? '—');
        }
    });
});

describe("CONTEXT-MAP.md's skill list", () => {
    it('names every skill the repo ships', () => {
        const listed = claimIn(
            CONTEXT_MAP,
            /Authoring conventions are encoded as skills under `\.agents\/skills\/` and `\.claude\/skills\/`: ([^.]*)\./
        )[0]
            .replace(/,? and /, ', ')
            .split(', ')
            .map((entry) => entry.replace(/`/g, ''))
            .sort();
        expect(listed).toEqual(readRepoSubdirectories('.agents/skills'));
        // `.claude/skills` is a directory of symlinks into `.agents/skills`,
        // so a skill added to one and not the other is a broken mirror rather
        // than a deliberate tool-specific convention.
        expect(readRepoSubdirectories('.claude/skills')).toEqual(
            readRepoSubdirectories('.agents/skills')
        );
    });
});
