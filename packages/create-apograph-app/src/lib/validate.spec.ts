import {
    databaseNameFrom,
    validateAppName,
    validateDatabaseUrl
} from './validate';

describe('validateAppName', () => {
    it.each(['my-cms', 'cms', 'my.cms', 'my_cms', 'cms2'])(
        'accepts %s',
        (name) => {
            expect(validateAppName(name)).toBeUndefined();
        }
    );

    it.each([
        ['', 'empty'],
        ['My-CMS', 'uppercase'],
        ['.hidden', 'a leading dot'],
        ['_private', 'a leading underscore'],
        ['my cms', 'a space'],
        ['my/cms', 'a slash']
    ])('rejects %s (%s)', (name) => {
        expect(validateAppName(name)).toBeDefined();
    });

    it('rejects a name past npm’s 214-character limit', () => {
        expect(validateAppName('a'.repeat(215))).toBeDefined();
    });
});

describe('validateDatabaseUrl', () => {
    it.each([
        'postgresql://apograph:apograph@localhost:5432/my_cms',
        'postgres://user@host/db'
    ])('accepts %s', (url) => {
        expect(validateDatabaseUrl(url)).toBeUndefined();
    });

    it('rejects a non-URL', () => {
        expect(validateDatabaseUrl('localhost:5432')).toBeDefined();
    });

    it('rejects another protocol', () => {
        expect(validateDatabaseUrl('mysql://host/db')).toBeDefined();
    });

    /**
     * A URL with no database name reaches `pg` as "use the libpq defaults",
     * which is how a migration ends up building a schema in a database nobody
     * named.
     */
    it('rejects a URL with no database name', () => {
        expect(
            validateDatabaseUrl('postgresql://apograph:apograph@localhost:5432')
        ).toBeDefined();
    });
});

describe('databaseNameFrom', () => {
    it('reads the database out of the path', () => {
        expect(
            databaseNameFrom(
                'postgresql://apograph:apograph@localhost:5432/my_cms'
            )
        ).toBe('my_cms');
    });

    it('falls back rather than throwing on an unparseable URL', () => {
        expect(databaseNameFrom('nonsense')).toBe('apograph');
    });
});
