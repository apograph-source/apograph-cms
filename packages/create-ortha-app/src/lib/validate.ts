/**
 * Rejects a directory name npm could not use as a package name.
 *
 * The generated `package.json` takes this verbatim, and npm refuses to install
 * into a project whose own name is invalid — which surfaces as a confusing
 * error about the app rather than about the name that was typed.
 */
export function validateAppName(name: string): string | undefined {
    if (!name) return 'A name is required.';
    if (name.length > 214) return 'That name is longer than npm allows (214).';
    if (name.startsWith('.') || name.startsWith('_')) {
        return 'A package name cannot start with "." or "_".';
    }
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
        return 'Use lowercase letters, digits, dots, hyphens and underscores.';
    }
    return undefined;
}

/** Rejects a connection string that is not a postgres URL. */
export function validateDatabaseUrl(url: string): string | undefined {
    let parsed: URL;

    try {
        parsed = new URL(url);
    } catch {
        return 'That is not a valid URL.';
    }
    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
        return 'Expected a postgresql:// connection string.';
    }
    if (!parsed.pathname.replace(/^\//, '')) {
        return 'The URL needs a database name, e.g. postgresql://…/my_cms.';
    }
    return undefined;
}

/** The database name inside a postgres connection string. */
export function databaseNameFrom(url: string): string {
    try {
        return new URL(url).pathname.replace(/^\//, '') || 'ortha';
    } catch {
        return 'ortha';
    }
}
