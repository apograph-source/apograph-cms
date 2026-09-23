import { createConsoleMailProvider } from './console-mail-provider';

const message = {
    to: 'ada@example.com',
    from: 'Ortha CMS <no-reply@example.com>',
    subject: 'You have been invited',
    text: 'Hello,\nhttps://cms.example.com/identity/accept-invite?token=s3cret\n',
    headers: { 'X-Orthacms-Mail-Kind': 'invite' }
};

describe('the console mail provider', () => {
    it('identifies itself as `console` on every row it handles', () => {
        expect(createConsoleMailProvider().id).toBe('console');
    });

    it('declares that it can neither mint an id nor be verified', () => {
        expect(createConsoleMailProvider().capabilities).toEqual({
            messageId: false,
            verifiable: false
        });
        // Declaring `verifiable: false` and implementing no `verify()` is the
        // honest pair: a boot check with nothing to reach proves nothing.
        expect(createConsoleMailProvider().verify).toBeUndefined();
    });

    it('writes the recipient, the subject and the link', async () => {
        const lines: string[] = [];
        await createConsoleMailProvider({ sink: (l) => lines.push(l) }).send(
            message
        );

        const written = lines.join('\n');
        expect(written).toContain('ada@example.com');
        expect(written).toContain('You have been invited');
        expect(written).toContain('token=s3cret');
        expect(written).toContain('X-Orthacms-Mail-Kind: invite');
    });

    it('can be asked to keep the secret out of the log', async () => {
        const lines: string[] = [];
        await createConsoleMailProvider({
            sink: (l) => lines.push(l),
            includeBody: false
        }).send(message);

        expect(lines.join('\n')).not.toContain('token=s3cret');
    });

    it('hands back no provider id, because it has none to give', async () => {
        const swallow = (): void => undefined;
        await expect(
            createConsoleMailProvider({ sink: swallow }).send(message)
        ).resolves.toEqual({});
    });
});
