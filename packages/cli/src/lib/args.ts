/**
 * Argv parsing for the `ortha` binary.
 *
 * Split out of `cli.ts` because that file runs `main()` on import: anything
 * left in it is untestable, and what is worth testing here is which arguments
 * mean "show the help" or "show the version" — the two a new user reaches for
 * first, and the two that answer before the app itself has to exist.
 */

export const USAGE = `ortha — the Ortha CMS command line

Usage: ortha <command> [options]

Commands:
  dev                    Run the API and admin dev servers together
  build                  Compile the server and build the admin bundle
  start                  Run the built server
  migrate                Apply every plugin's pending migrations
  generate [--name=<n>]  Generate a migration for this app's content tables
  studio [--host --port] Open Drizzle Studio on this app's database

Options:
  --server               build/dev: the server only, skipping the admin
  --admin                build/dev: the admin only, skipping the server
  -h, --help             Show this message
  -v, --version          Show the installed version

--server and --admin are alternatives; passing both narrows the command to
nothing at all, so it is refused rather than obeyed.
`;

/** Reads `--flag=value`, or `--flag value`, from argv. */
export function option(
    argv: readonly string[],
    name: string
): string | undefined {
    const inline = argv.find((arg) => arg.startsWith(`--${name}=`));
    if (inline) return inline.slice(`--${name}=`.length);

    const index = argv.indexOf(`--${name}`);
    const next = index === -1 ? undefined : argv[index + 1];

    return next && !next.startsWith('-') ? next : undefined;
}

/** Whether a bare `--flag` is present. */
export function flag(argv: readonly string[], name: string): boolean {
    return argv.includes(`--${name}`);
}

/** Which half of the app a command was narrowed to. */
export interface Halves {
    /** Skip the admin. */
    serverOnly: boolean;
    /** Skip the server. */
    adminOnly: boolean;
}

/**
 * Reads `--server` / `--admin` for the two commands that run both halves.
 *
 * Both at once is refused rather than obeyed. `--server` means "skip the admin"
 * and `--admin` means "skip the server", so together they narrow the command to
 * nothing: `ortha build --server --admin` used to compile nothing, build
 * nothing and exit 0, which reads as a build that succeeded.
 */
export function halves(argv: readonly string[], command: string): Halves {
    const serverOnly = flag(argv, 'server');
    const adminOnly = flag(argv, 'admin');

    if (serverOnly && adminOnly) {
        throw new Error(
            `\`ortha ${command} --server --admin\` asks for neither half — ` +
                `--server skips the admin and --admin skips the server. Pass ` +
                `one, or neither for both.`
        );
    }

    return { serverOnly, adminOnly };
}

/**
 * Reads a `--<name>` option that must be a whole number.
 *
 * `Number()` alone is not enough, and the difference is not academic: it maps
 * `--port=abc` to `NaN` and `--port=` to `0`, and both of those then reached a
 * truthiness guard that dropped them without a word — so a typo in a port
 * silently became the default port.
 */
export function numberOption(
    argv: readonly string[],
    name: string
): number | undefined {
    const raw = option(argv, name);
    if (raw === undefined) return undefined;

    if (!/^\d+$/.test(raw)) {
        throw new Error(
            `--${name} must be a whole number — got "${raw}". Drop the flag to ` +
                `use the default.`
        );
    }

    return Number(raw);
}

/**
 * Whether this invocation is asking for the usage text.
 *
 * Deliberately reads the **whole** argv rather than the arguments after the
 * command. `ortha --help` puts `--help` in the command position, and a check
 * that only looked past it fell through to the `switch` and answered the most
 * common first command with `Unknown command "--help"` and exit code 1.
 *
 * `help` as a bare word is accepted for the same reason: it costs one clause
 * and it is what people type when the flag has just failed them.
 */
export function wantsHelp(args: readonly string[]): boolean {
    return (
        args.length === 0 ||
        args[0] === 'help' ||
        args.includes('--help') ||
        args.includes('-h')
    );
}

/**
 * Whether this invocation is asking which version is installed.
 *
 * Checked before {@link wantsHelp}, so `ortha --version --help` answers with
 * the number — the same precedence `node` and `git` use.
 */
export function wantsVersion(args: readonly string[]): boolean {
    return args.includes('--version') || args.includes('-v');
}
