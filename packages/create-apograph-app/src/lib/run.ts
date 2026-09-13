/**
 * The scaffolder itself: read the flags, ask what a terminal can be asked,
 * write the app.
 *
 * Separate from `src/cli.ts`, which is the `bin` and does nothing but call
 * `main()` and turn a thrown error into an exit code. The split is what makes
 * this testable: importing a module that scaffolds on import would scaffold
 * during a test run, so the refusals and the defaults below could only be
 * checked by spawning a process.
 */
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
    COPILOT_PROVIDERS,
    SSO_PROVIDERS,
    MEDIA_PROVIDERS,
    PROTOCOLS,
    resolvePackages,
    type Feature,
    type FeatureSelection
} from './features';
import { isNonEmptyDirectory, renderTemplate } from './template';
import * as ui from './ui';
import {
    databaseNameFrom,
    validateAppName,
    validateDatabaseUrl
} from './validate';

export const USAGE = `create-apograph-app — scaffold an Apograph CMS app

Usage: npx create-apograph-app <directory> [options]

Options:
  --yes            Accept every default, asking nothing
  --media <id>     Storage adapter (default: media-local)
  --copilot <ids>  Comma-separated copilot providers, or "none"
  --sso <ids>      Comma-separated identity providers (sso-oidc, sso-github,
                   sso-saml), or "none"
  --protocols <ids> Comma-separated protocols beyond REST (graphql, mcp), or "none"
  --no-install     Skip installing dependencies
  --no-git         Skip initialising a git repository
  -h, --help       Show this message
`;

/** Whether a bare `--flag` is present. */
function flag(argv: readonly string[], name: string): boolean {
    return argv.includes(`--${name}`);
}

/** Reads `--name=value` or `--name value` from argv. */
function option(argv: readonly string[], name: string): string | undefined {
    const inline = argv.find((arg) => arg.startsWith(`--${name}=`));
    if (inline) return inline.slice(`--${name}=`.length);

    const index = argv.indexOf(`--${name}`);
    const next = index === -1 ? undefined : argv[index + 1];

    return next && !next.startsWith('-') ? next : undefined;
}

/** Splits a comma-separated flag value; `none` means an empty selection. */
function idList(raw: string | undefined): string[] | undefined {
    if (raw === undefined) return undefined;
    if (raw.trim() === 'none') return [];

    return raw
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
}

/**
 * The ids a `--media` / `--copilot` / `--sso` / `--protocols` flag named, checked
 * against the group it belongs to.
 *
 * An id nobody recognises has to stop the run. The flags take *feature ids*
 * (`media-s3`), not the label or the bare adapter name, and `--media s3` is the
 * natural guess — it used to select nothing, and "nothing" is a real answer for
 * three of the four groups, so it scaffolded an app quietly missing whatever was
 * asked for. For storage that app cannot even compile: no adapter means no
 * `storage` setting and no `mediaStorage()` for the config to call. Naming the
 * valid ids here costs a typo nothing and turns a broken app into one line of
 * output.
 *
 * `required` marks a single-choice group that must end up with something —
 * storage, where "no adapter" is not a configuration an app can run.
 */
function selected(
    argv: readonly string[],
    name: string,
    group: readonly Feature[],
    required = false
): string[] {
    const chosen = idList(option(argv, name)) ?? defaultsOf(group);
    const known = new Set(group.map((feature) => feature.id));
    const unknown = chosen.filter((id) => !known.has(id));

    if (unknown.length > 0) {
        throw new Error(
            `--${name}: no such option ${unknown.map((id) => `"${id}"`).join(', ')}. ` +
                `Expected ${[...known].join(', ')}${required ? '' : ', or none'}.`
        );
    }
    if (required && chosen.length === 0) {
        throw new Error(
            `--${name}: an app needs one of ${[...known].join(', ')} — ` +
                'there is no configuration for "no adapter at all".'
        );
    }
    return chosen;
}

/**
 * This package's own version, which every `@apograph/*` dependency in the
 * generated app is pinned to.
 *
 * The scaffolder is released in lockstep with the packages it scaffolds, so its
 * version *is* the matching set — which is the whole mechanism keeping a
 * generated app internally consistent. Reading it from the manifest rather than
 * resolving `latest` from the registry also means `npx create-apograph-app@0.3.0`
 * generates a 0.3.0 app, not whatever shipped since.
 */
function ownVersion(): string {
    const manifest = join(__dirname, '../../package.json');
    return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string })
        .version;
}

/** Runs a command in `cwd`, returning whether it succeeded. */
function runCommand(command: string, args: string[], cwd: string): boolean {
    return (
        spawnSync(command, args, {
            cwd,
            stdio: 'inherit',
            shell: process.platform === 'win32'
        }).status === 0
    );
}

/** Turns a feature into a picker row. */
function toChoice(feature: Feature): ui.Choice {
    return {
        value: feature.id,
        label: feature.label,
        hint: feature.hint,
        selected: feature.enabledByDefault,
        disabled: !feature.available,
        locked: feature.locked
    };
}

/**
 * The ids a feature group falls back to when nothing is picked.
 *
 * A locked feature is in every answer, including `--protocols none`: REST is
 * not something the flag can switch off.
 */
function defaultsOf(features: readonly Feature[]): string[] {
    return features
        .filter(
            (feature) =>
                (feature.enabledByDefault || feature.locked) &&
                feature.available
        )
        .map((feature) => feature.id);
}

/** The ids that are on regardless of what was asked or passed. */
export function lockedOf(features: readonly Feature[]): string[] {
    return features
        .filter((feature) => feature.locked && feature.available)
        .map((feature) => feature.id);
}

/** Asks a free-text question, re-asking until it validates. */
async function askText(
    label: string,
    fallback: string,
    validate?: (answer: string) => string | undefined
): Promise<string> {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        for (;;) {
            const raw = await rl.question(
                `${ui.cyan('◆')} ${ui.bold(label)} ${ui.dim(`(${fallback})`)} `
            );
            const answer = raw.trim() || fallback;
            const problem = validate?.(answer);

            if (!problem) return answer;
            ui.error(problem);
        }
    } finally {
        rl.close();
    }
}

/** Everything the wizard resolves. */
export interface Answers {
    appName: string;
    databaseUrl: string;
    adminEmail: string;
    selection: FeatureSelection;
}

/**
 * Resolves the answers, asking only when there is a terminal to ask in.
 *
 * Non-interactive is not an error case to warn about — it is CI, a piped
 * install, and `--yes`. A scaffolder that blocks on a prompt nobody can answer
 * hangs a pipeline until it times out, which is a far worse failure than
 * defaulting, so the flags and the defaults cover every question.
 */
export async function resolveAnswers(
    argv: readonly string[],
    defaultName: string
): Promise<Answers> {
    const asked = !flag(argv, 'yes') && ui.interactive();

    const defaultDatabaseUrl = `postgresql://apograph:apograph@localhost:5432/${defaultName.replace(
        /[^a-z0-9_]/gi,
        '_'
    )}`;

    // Storage is `required`: it is a single choice, and an app with no adapter
    // has no `storage` setting for `plugins.ts` to hand its factory.
    const media = selected(argv, 'media', MEDIA_PROVIDERS, true);
    const copilot = selected(argv, 'copilot', COPILOT_PROVIDERS);
    const sso = selected(argv, 'sso', SSO_PROVIDERS);
    const protocols = [
        ...lockedOf(PROTOCOLS),
        ...selected(argv, 'protocols', PROTOCOLS)
    ];

    if (!asked) {
        return {
            appName: defaultName,
            databaseUrl: defaultDatabaseUrl,
            adminEmail: 'admin@example.com',
            selection: {
                enabled: new Set([...media, ...copilot, ...sso, ...protocols])
            }
        };
    }

    ui.section('Project');
    const appName = await askText('App name', defaultName, validateAppName);
    const databaseUrl = await askText(
        'Database URL',
        defaultDatabaseUrl,
        validateDatabaseUrl
    );
    const adminEmail = await askText('Admin email', 'admin@example.com');

    ui.section('Features');
    ui.note('Everything else is installed for you. These are the choices.');
    console.log('');

    // Only ask when there is more than one answer available — a question with a
    // single possible reply is noise pretending to be a choice. Every adapter
    // is published today, so the question is asked; it stops being asked by
    // itself if all but one are ever marked unavailable.
    const selectable = MEDIA_PROVIDERS.filter((provider) => provider.available);
    const chosenMedia =
        selectable.length > 1
            ? [
                  (await ui.select(
                      'Where should uploads be stored?',
                      MEDIA_PROVIDERS.map(toChoice)
                  )) ?? media[0]
              ]
            : media;

    const chosenCopilot =
        (await ui.multiselect(
            'AI copilot — which model backends?',
            COPILOT_PROVIDERS.map(toChoice)
        )) ?? copilot;

    const chosenSso =
        (await ui.multiselect(
            'Single sign-on — which identity providers?',
            SSO_PROVIDERS.map(toChoice)
        )) ?? sso;

    const chosenProtocols =
        (await ui.multiselect(
            'Which protocols should the content API speak?',
            PROTOCOLS.map(toChoice)
        )) ?? protocols;

    return {
        appName,
        databaseUrl,
        adminEmail,
        selection: {
            enabled: new Set([
                ...chosenMedia.filter(Boolean),
                ...chosenCopilot,
                ...chosenSso,
                ...chosenProtocols
            ] as string[])
        }
    };
}

/** Human-readable summary of what was chosen. */
function describeSelection(
    selection: FeatureSelection
): (readonly [string, string])[] {
    const labelsFor = (features: readonly Feature[]): string => {
        const chosen = features
            .filter((feature) => selection.enabled.has(feature.id))
            .map((feature) => feature.label);
        return chosen.length > 0 ? chosen.join(', ') : ui.dim('none');
    };

    const providers = COPILOT_PROVIDERS.filter((provider) =>
        selection.enabled.has(provider.id)
    );

    return [
        ['Storage', labelsFor(MEDIA_PROVIDERS)],
        ['Protocols', labelsFor(PROTOCOLS)],
        [
            'Copilot',
            providers.length > 0
                ? providers.map((p) => p.label).join(', ')
                : ui.dim('no backend')
        ],
        ['Sign-in', labelsFor(SSO_PROVIDERS)],
        ['Apograph packages', String(resolvePackages(selection).length + 1)]
    ];
}

export async function main(
    argv: readonly string[] = process.argv.slice(2)
): Promise<void> {
    if (flag(argv, 'help') || argv.includes('-h')) {
        console.log(USAGE);
        return;
    }

    const positional = argv.filter((arg) => !arg.startsWith('-'));
    const target = resolve(positional[0] ?? '.');

    ui.banner('Apograph CMS', `Creating an app in ${target}`);

    if (isNonEmptyDirectory(target)) {
        throw new Error(
            `${target} already exists and is not empty. Pick a new directory, ` +
                `or empty that one first.`
        );
    }

    const answers = await resolveAnswers(argv, basename(target));

    // Generated rather than prompted: a password typed at a prompt is echoed to
    // the terminal and lands in shell history. This one is written only to the
    // git-ignored .env, and printed once below.
    const adminPassword = randomBytes(12).toString('base64url');

    ui.summary('Your app', [
        ['Name', answers.appName],
        ['Database', databaseNameFrom(answers.databaseUrl)],
        ...describeSelection(answers.selection)
    ]);

    mkdirSync(target, { recursive: true });

    renderTemplate(join(__dirname, '../../templates/default'), target, {
        appName: answers.appName,
        appTitle: answers.appName,
        databaseUrl: answers.databaseUrl,
        databaseName: databaseNameFrom(answers.databaseUrl),
        adminEmail: answers.adminEmail,
        adminPassword,
        apographVersion: ownVersion(),
        selection: answers.selection
    });

    console.log('');
    ui.success('Files written');

    if (!flag(argv, 'no-git') && !existsSync(join(target, '.git'))) {
        if (runCommand('git', ['init', '--quiet'], target)) {
            ui.success('Git repository initialised');
        }
    }

    let installed = true;
    if (!flag(argv, 'no-install')) {
        console.log('');
        ui.note('Installing dependencies…');
        installed = runCommand(
            'npm',
            ['install', '--no-audit', '--no-fund'],
            target
        );
        if (installed) ui.success('Dependencies installed');
    }

    if (!installed) {
        ui.error(
            'Dependency installation failed — fix the error above, then run ' +
                '`npm install` in the new directory.'
        );
        process.exitCode = 1;
    }

    ui.summary('Your admin account', [
        ['Email', answers.adminEmail],
        ['Password', ui.bold(adminPassword)],
        ['', ui.dim('Also written to .env')]
    ]);

    ui.nextSteps([
        `cd ${basename(target)}`,
        ...(flag(argv, 'no-install') ? ['npm install'] : []),
        'docker compose up -d',
        'npm run migrate',
        `npm run dev        ${ui.dim('→ http://localhost:4200')}`
    ]);
}
