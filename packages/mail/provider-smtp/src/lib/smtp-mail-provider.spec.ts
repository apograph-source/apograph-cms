import { MailPermanentError } from '@ortha/mail-domain';
import { createSmtpMailProvider } from './smtp-mail-provider';
import { describeSmtpError, isPermanentSmtpError } from './smtp-error';

const message = {
    to: 'ada@example.com',
    from: 'Ortha <no-reply@example.com>',
    replyTo: 'support@example.com',
    subject: 'You have been invited',
    text: 'https://cms.example.com/identity/accept-invite?token=s3cret',
    html: '<p>link</p>',
    headers: { 'X-Ortha-Mail-Kind': 'invite' }
};

/** A nodemailer double: records what it was asked to send. */
function fakeTransport(behaviour: { fail?: unknown } = {}) {
    const sent: Record<string, unknown>[] = [];
    return {
        sent,
        sendMail: jest.fn(async (mail: Record<string, unknown>) => {
            if (behaviour.fail) throw behaviour.fail;
            sent.push(mail);
            return { messageId: '<queued@relay>' };
        }),
        verify: jest.fn(async () => {
            if (behaviour.fail) throw behaviour.fail;
            return true;
        })
    };
}

describe('the SMTP mail provider', () => {
    it('identifies itself as `smtp` and declares what it can do', () => {
        const provider = createSmtpMailProvider({
            host: 'smtp.example.com',
            transport: fakeTransport()
        });
        expect(provider.id).toBe('smtp');
        expect(provider.capabilities).toEqual({
            messageId: true,
            verifiable: true
        });
    });

    it('passes the whole message through, sender included', async () => {
        const transport = fakeTransport();
        const provider = createSmtpMailProvider({
            host: 'smtp.example.com',
            transport
        });

        const receipt = await provider.send(message);

        expect(transport.sent[0]).toEqual({
            from: 'Ortha <no-reply@example.com>',
            to: 'ada@example.com',
            replyTo: 'support@example.com',
            subject: 'You have been invited',
            text: message.text,
            html: '<p>link</p>',
            headers: { 'X-Ortha-Mail-Kind': 'invite' }
        });
        expect(receipt).toEqual({ providerMessageId: '<queued@relay>' });
    });

    it('omits the optional parts rather than sending them empty', async () => {
        const transport = fakeTransport();
        const provider = createSmtpMailProvider({
            host: 'smtp.example.com',
            transport
        });

        await provider.send({
            to: message.to,
            from: message.from,
            subject: message.subject,
            text: message.text
        });

        expect(transport.sent[0]).not.toHaveProperty('replyTo');
        expect(transport.sent[0]).not.toHaveProperty('html');
        expect(transport.sent[0]).not.toHaveProperty('headers');
    });

    it('turns a 5xx reply into a permanent error, so the row stops', async () => {
        const provider = createSmtpMailProvider({
            host: 'smtp.example.com',
            transport: fakeTransport({
                fail: Object.assign(new Error('rejected'), {
                    responseCode: 550,
                    response: '550 5.1.1 unknown recipient',
                    code: 'EENVELOPE'
                })
            })
        });

        await expect(provider.send(message)).rejects.toBeInstanceOf(
            MailPermanentError
        );
        await expect(provider.send(message)).rejects.toThrow(
            /unknown recipient/
        );
    });

    it('leaves a transport failure retryable', async () => {
        const provider = createSmtpMailProvider({
            host: 'smtp.example.com',
            transport: fakeTransport({
                fail: Object.assign(new Error('connect ETIMEDOUT'), {
                    code: 'ETIMEDOUT'
                })
            })
        });

        await expect(provider.send(message)).rejects.not.toBeInstanceOf(
            MailPermanentError
        );
    });

    it('names the relay when the boot check cannot reach it', async () => {
        const provider = createSmtpMailProvider({
            host: 'smtp.example.com',
            port: 2525,
            transport: fakeTransport({
                fail: Object.assign(new Error('no route'), {
                    code: 'ECONNECTION'
                })
            })
        });

        await expect(provider.verify?.()).rejects.toThrow(
            /smtp\.example\.com:2525/
        );
    });

    it('refuses a configuration that could only fail later', () => {
        expect(() => createSmtpMailProvider({ host: '' })).toThrow(/host/);
        expect(() =>
            createSmtpMailProvider({ host: 'smtp.example.com', port: 0 })
        ).toThrow(/TCP port/);
        expect(() =>
            createSmtpMailProvider({
                host: 'smtp.example.com',
                password: 'hunter2'
            })
        ).toThrow(/password but no user/);
    });
});

describe('classifying an SMTP failure', () => {
    it.each([
        ['a 5xx reply', { responseCode: 550 }, true],
        ['a 4xx reply', { responseCode: 451 }, false],
        ['a refused envelope', { code: 'EENVELOPE' }, true],
        ['a refused message', { code: 'EMESSAGE' }, true],
        ['a dead connection', { code: 'ECONNECTION' }, false],
        // Retryable on purpose: bad credentials are a property of the
        // deployment, not of this message, and a rotation that flaps for a
        // minute should not kill every queued invitation at once.
        ['a rejected credential', { code: 'EAUTH' }, false],
        ['something that is not an error at all', null, false]
    ])('%s', (_case, shape, expected) => {
        const error = shape
            ? Object.assign(new Error('boom'), shape)
            : (shape as unknown);
        expect(isPermanentSmtpError(error)).toBe(expected);
    });

    it('prefers the relay’s own words for the delivery log', () => {
        expect(
            describeSmtpError(
                Object.assign(new Error('rejected'), {
                    code: 'EENVELOPE',
                    response: '550 5.1.1 unknown recipient'
                })
            )
        ).toBe('EENVELOPE: 550 5.1.1 unknown recipient');
    });

    it('falls back to the message when there is no reply text', () => {
        expect(describeSmtpError(new Error('socket hang up'))).toBe(
            'socket hang up'
        );
    });
});
