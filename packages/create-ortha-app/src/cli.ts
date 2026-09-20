#!/usr/bin/env node
/**
 * The `create-ortha-app` binary.
 *
 * Nothing but the entry point: the scaffolder lives in `lib/run.ts`, so a test
 * can import it without a module that writes an app the moment it is required.
 */
import { main } from './lib/run';
import * as ui from './lib/ui';

main().catch((error: unknown) => {
    ui.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
