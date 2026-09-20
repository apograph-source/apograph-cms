#!/usr/bin/env node
import {
    USAGE,
    halves,
    numberOption,
    option,
    wantsHelp,
    wantsVersion
} from './lib/args';
import { buildCommand } from './lib/commands/build';
import { devCommand } from './lib/commands/dev';
import { generateCommand } from './lib/commands/generate';
import { migrateCommand } from './lib/commands/migrate';
import { startCommand } from './lib/commands/start';
import { studioCommand } from './lib/commands/studio';
import { loadEnv } from './lib/env';
import { findProjectRoot } from './lib/project';
import { cliVersion } from './lib/version';

async function main(): Promise<void> {
    const args = process.argv.slice(2);

    // Both before `findProjectRoot`, so asking what the command is and which
    // version it is works from anywhere — including the shell you are in
    // before the app exists.
    if (wantsVersion(args)) {
        console.log(cliVersion());
        return;
    }

    if (wantsHelp(args)) {
        console.log(USAGE);
        return;
    }

    const [command, ...argv] = args;

    const root = findProjectRoot();

    // Before any command runs, so `ortha.config.ts` finds its settings and the
    // processes `dev`/`start` spawn inherit them.
    loadEnv(root);

    switch (command) {
        case 'dev':
            return devCommand(root, halves(argv, 'dev'));
        case 'build':
            return buildCommand(root, halves(argv, 'build'));
        case 'start':
            return startCommand(root);
        case 'migrate':
            return migrateCommand(root);
        case 'generate':
            return generateCommand(root, option(argv, 'name'));
        case 'studio':
            return studioCommand(root, {
                host: option(argv, 'host'),
                port: numberOption(argv, 'port')
            });
        default:
            console.error(`Unknown command "${command}".\n`);
            console.log(USAGE);
            process.exitCode = 1;
    }
}

main().catch((error: unknown) => {
    // The message, not the stack. Every throw reaching here is a condition the
    // user can act on — an unbuilt app, a missing DATABASE_URL, a failed
    // migration naming the plugin — and a stack trace buries the sentence that
    // says which.
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
