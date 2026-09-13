import { join } from 'node:path';
import * as ts from 'typescript';

import {
    readRepoDir,
    readRepoFile,
    readRepoSubdirectories,
    repoPathExists
} from './repo';

const sourceFileOf = (relative: string): ts.SourceFile =>
    ts.createSourceFile(
        relative,
        readRepoFile(relative),
        ts.ScriptTarget.Latest,
        true
    );

const walk = (node: ts.Node, visit: (node: ts.Node) => void): void => {
    visit(node);
    node.forEachChild((child) => walk(child, visit));
};

/** One field of a documented contract, as the code declares it. */
export type ContractField = { name: string; optional: boolean };

const fieldsOf = (members: ts.NodeArray<ts.TypeElement>): ContractField[] =>
    members
        .filter(
            (member): member is ts.PropertySignature | ts.MethodSignature =>
                (ts.isPropertySignature(member) ||
                    ts.isMethodSignature(member)) &&
                ts.isIdentifier(member.name)
        )
        .map((member) => ({
            name: (member.name as ts.Identifier).text,
            optional: member.questionToken !== undefined
        }));

/**
 * The fields of an `interface X {}` or `type X = {}` declaration, in source
 * order — the truth behind every code block in the root documents that shows a
 * plugin contract.
 */
export const contractFields = (
    relative: string,
    typeName: string
): ContractField[] => {
    const source = sourceFileOf(relative);
    let fields: ContractField[] | undefined;
    walk(source, (node) => {
        if (ts.isInterfaceDeclaration(node) && node.name.text === typeName) {
            fields = fieldsOf(node.members);
        }
        if (
            ts.isTypeAliasDeclaration(node) &&
            node.name.text === typeName &&
            ts.isTypeLiteralNode(node.type)
        ) {
            fields = fieldsOf(node.type.members);
        }
    });
    if (!fields) {
        throw new Error(`${relative} declares no type named ${typeName}`);
    }
    return fields;
};

/**
 * The fields a fenced TypeScript block in a markdown document shows for
 * `typeName`, read as text rather than parsed: the block is an excerpt with
 * comments where the real types are, so it is not valid on its own.
 */
export const documentedContractFields = (
    markdown: string,
    typeName: string
): ContractField[] => {
    const declaration = new RegExp(
        `(?:interface|type)\\s+${typeName}\\s*=?\\s*\\{([\\s\\S]*?)\\n\\}`
    ).exec(markdown);
    if (!declaration) {
        throw new Error(`no code block declaring ${typeName} in the document`);
    }
    return declaration[1]
        .split('\n')
        .map((line) => /^\s{4}(\w+)(\??)\s*[:(]/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => ({ name: match[1], optional: match[2] === '?' }));
};

/**
 * Every slot id a module defines through `createSlot`, in source order.
 *
 * Read from the call rather than from the exported constant's name: the id is
 * what a contributing plugin actually addresses, and it is what the documents
 * group by (`content.records.*` around the list, `content.entry.*` around the
 * editor).
 */
export const slotIdsDefinedIn = (relative: string): string[] => {
    const ids: string[] = [];
    walk(sourceFileOf(relative), (node) => {
        if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === 'createSlot' &&
            node.arguments.length > 0 &&
            ts.isStringLiteral(node.arguments[0])
        ) {
            ids.push((node.arguments[0] as ts.StringLiteral).text);
        }
    });
    return ids;
};

/** The `provider-*` package directories of a package group, sorted. */
export const providerPackagesOf = (group: string): string[] =>
    readRepoDir(`packages/${group}`).filter((entry) =>
        entry.startsWith('provider-')
    );

/** The package groups shipping a framework-free `domain` kernel, sorted. */
export const domainKernels = (): string[] =>
    readRepoDir('packages').filter((group) =>
        repoPathExists(join('packages', group, 'domain'))
    );

/**
 * The tables a plugin owns, derived by replaying its committed migrations in
 * filename order: every `CREATE TABLE` adds one and every `DROP TABLE` removes
 * one.
 *
 * The migrations are the ownership record, not the schema modules — a plugin
 * may declare a `pgTable` for a table another plugin creates, purely to have
 * something to reference (copilot's `external-refs.ts` declares `users` and
 * `workspaces` that way), and counting those would credit it with tables it
 * does not migrate.
 */
export const tablesOwnedBy = (packageRelative: string): string[] => {
    const migrations = `${packageRelative}/migrations`;
    if (!repoPathExists(migrations)) return [];
    const owned = new Set<string>();
    for (const file of readRepoDir(migrations).filter((name) =>
        name.endsWith('.sql')
    )) {
        const sql = readRepoFile(`${migrations}/${file}`);
        for (const [, table] of sql.matchAll(
            /CREATE TABLE (?:IF NOT EXISTS )?"([^"]+)"/g
        )) {
            owned.add(table);
        }
        for (const [, table] of sql.matchAll(
            /DROP TABLE (?:IF EXISTS )?"([^"]+)"/g
        )) {
            owned.delete(table);
        }
    }
    return [...owned].sort();
};

/** A project the workspace ships, as the file system reports it. */
export type WorkspaceProject = {
    /** `apps`, `packages` or `tools` — which table of the map it belongs in. */
    area: string;
    /** Path relative to its area — the map's first column. */
    path: string;
    /**
     * The name npm publishes it under. Only `packages/` has one: an app and a
     * tooling project each carry a `name` for the tooling's sake, but neither
     * is published, so the map prints an em dash rather than a name a reader
     * could try to install.
     */
    packageName?: string;
};

const projectAt = (
    area: string,
    directory: string,
    path: string
): WorkspaceProject | undefined => {
    if (repoPathExists(join(directory, 'package.json'))) {
        const { name } = JSON.parse(
            readRepoFile(join(directory, 'package.json'))
        ) as { name?: string };
        return {
            area,
            path,
            packageName: area === 'packages' ? name : undefined
        };
    }
    return repoPathExists(join(directory, 'project.json'))
        ? { area, path }
        : undefined;
};

/**
 * Every project the workspace ships: the apps, the packages (flat and grouped
 * one level deep), and the tooling projects.
 *
 * Read from the file system rather than from the Nx graph — building the graph
 * costs seconds and drags in every inference plugin, and the two agree on
 * exactly the question being asked here: what directories are projects.
 */
export const workspaceProjects = (): WorkspaceProject[] => {
    const projects: WorkspaceProject[] = [];
    for (const area of ['apps', 'packages', 'tools']) {
        for (const entry of readRepoSubdirectories(area)) {
            const direct = projectAt(area, join(area, entry), entry);
            if (direct) {
                projects.push(direct);
                continue;
            }
            // A package group: `packages/content/{domain,server,admin,graphql}`.
            for (const child of readRepoSubdirectories(join(area, entry))) {
                const nested = projectAt(
                    area,
                    join(area, entry, child),
                    `${entry}/${child}`
                );
                if (nested) projects.push(nested);
            }
        }
    }
    return projects;
};
