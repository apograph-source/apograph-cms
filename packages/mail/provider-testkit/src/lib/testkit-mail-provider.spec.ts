import { MailPermanentError } from '@orthacms/mail-domain';
import { createTestkitMailProvider } from './testkit-mail-provider';

const message = {
    to: 'ada@example.com',
    from: 'Ortha <no-reply@example.com>',
    subject: 'You have been invited',
    text: 'https://cms.example.com/identity/accept-invite?token=s3cret'
};

describe('the testkit mail provider', () => {
    it('captures what it was handed, in order', async () => {
        const provider = createTestkitMailProvider();

        await provider.send(message);
        await provider.send({ ...message, to: 'grace@example.com' });

        expect(provider.sent.map((mail) => mail.to)).toEqual([
            'ada@example.com',
            'grace@example.com'
        ]);
        expect(provider.last()?.to).toBe('grace@example.com');
    });

    it('mints an id per message when it declares it can', async () => {
        const provider = createTestkitMailProvider();
        expect(await provider.send(message)).toEqual({
            providerMessageId: 'testkit-1'
        });
        expect(await provider.send(message)).toEqual({
            providerMessageId: 'testkit-2'
        });
    });

    it('hands back nothing when it declares it cannot', async () => {
        const provider = createTestkitMailProvider({ messageId: false });
        expect(await provider.send(message)).toEqual({});
    });

    it('fails a scripted number of attempts, retryably', async () => {
        const provider = createTestkitMailProvider();
        provider.failNext(2);

        await expect(provider.send(message)).rejects.not.toBeInstanceOf(
            MailPermanentError
        );
        await expect(provider.send(message)).rejects.toThrow();
        // Third attempt: the scripted failures are spent.
        await expect(provider.send(message)).resolves.toBeDefined();
        expect(provider.sent).toHaveLength(1);
    });

    it('fails permanently until told otherwise, capturing nothing', async () => {
        const provider = createTestkitMailProvider();
        provider.failPermanently('the address was rejected');

        await expect(provider.send(message)).rejects.toBeInstanceOf(
            MailPermanentError
        );
        await expect(provider.verify?.()).rejects.toBeInstanceOf(
            MailPermanentError
        );
        expect(provider.sent).toHaveLength(0);

        provider.succeed();
        await expect(provider.send(message)).resolves.toBeDefined();
    });

    it('forgets everything on reset, including a scripted failure', async () => {
        const provider = createTestkitMailProvider();
        await provider.send(message);
        provider.failPermanently();

        provider.reset();

        expect(provider.sent).toHaveLength(0);
        await expect(provider.send(message)).resolves.toBeDefined();
    });
});
