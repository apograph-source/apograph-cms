import { fromHeaderRows, rejectionFor, toHeaderRows } from './index';

describe('which headers an endpoint may set', () => {
    it('takes an ordinary header', () => {
        expect(rejectionFor('Authorization')).toBeNull();
        expect(rejectionFor('X-Api-Key')).toBeNull();
    });

    it('refuses the delivery’s own metadata', () => {
        // Overwriting these would let a delivery claim to be something it is
        // not — a different event, or one signed by someone else.
        expect(rejectionFor('X-Ortha-Signature')).toBe('reserved');
        expect(rejectionFor('x-ortha-event')).toBe('reserved');
    });

    it('refuses headers the transport owns', () => {
        // `Host` is how a request aimed at one virtual host is served by
        // another.
        for (const name of ['Host', 'content-type', 'User-Agent']) {
            expect(rejectionFor(name)).toBe('reserved');
        }
    });

    it('refuses a name that is not a header name at all', () => {
        for (const name of ['', '   ', 'has space', 'colon:', 'ü']) {
            expect(rejectionFor(name)).toBe('malformed');
        }
    });
});

describe('the headers editor’s rows', () => {
    it('round-trips a stored map', () => {
        const headers = { Authorization: 'Bearer t', 'X-Api-Key': 'k' };
        expect(fromHeaderRows(toHeaderRows(headers))).toEqual(headers);
    });

    it('drops a row that names nothing', () => {
        // An open, empty row is someone about to type, not a request to send a
        // blank header.
        expect(
            fromHeaderRows([
                { key: '1', name: '  ', value: 'ignored' },
                { key: '2', name: 'X-Api-Key', value: 'k' }
            ])
        ).toEqual({ 'X-Api-Key': 'k' });
    });

    it('keeps a header with an empty value', () => {
        expect(
            fromHeaderRows([{ key: '1', name: 'X-Empty', value: '' }])
        ).toEqual({ 'X-Empty': '' });
    });

    it('lets the later of two same-named rows win, as a map would', () => {
        expect(
            fromHeaderRows([
                { key: '1', name: 'X-Api-Key', value: 'old' },
                { key: '2', name: 'X-Api-Key', value: 'new' }
            ])
        ).toEqual({ 'X-Api-Key': 'new' });
    });
});
