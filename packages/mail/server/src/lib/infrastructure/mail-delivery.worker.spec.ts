import { createTestkitMailProvider } from '@orthacms/mail-provider-testkit';
import { MailDeliveryWorker } from './mail-delivery.worker';
import type {
    ClaimedMail,
    MailDeliveryRepository
} from './mail-delivery.repository';
import { resolveMailConfig } from '../types/mail-config';

const claimed: ClaimedMail = {
    id: 'delivery-1',
    kind: 'invite',
    toAddress: 'ada@example.com',
    subject: 'You have been invited',
    bodyText: 'https://cms.example.com/identity/accept-invite?token=s3cret',
    bodyHtml: '<p>link</p>',
    attempts: 0
};

/** A repository double that records what the worker did to each row. */
function fakeRepository(queue: ClaimedMail[] = []) {
    return {
        // Typed signatures rather than bare `jest.fn()`: the assertions below
        // read the recorded arguments, and an untyped mock makes every one of
        // them `any`.
        claim: jest.fn<Promise<ClaimedMail[]>, [number, number]>(async () =>
            queue.splice(0, queue.length)
        ),
        markDelivered: jest.fn<Promise<void>, [string]>(async () => undefined),
        markRetrying: jest.fn<Promise<void>, [string, string, Date, string]>(
            async () => undefined
        ),
        markDead: jest.fn<Promise<void>, [string, string, string]>(
            async () => undefined
        ),
        sweepExpired: jest.fn<Promise<number>, []>(async () => 0)
    };
}

function workerFor(
    repository: ReturnType<typeof fakeRepository>,
    provider = createTestkitMailProvider(),
    overrides: Parameters<typeof resolveMailConfig>[0] = {
        appUrl: 'https://cms.example.com',
        from: 'Ortha <no-reply@example.com>'
    }
) {
    return {
        provider,
        worker: new MailDeliveryWorker(
            repository as unknown as MailDeliveryRepository,
            provider,
            resolveMailConfig(overrides)
        )
    };
}

describe('the mail delivery worker', () => {
    it('hands a claimed message over and deletes the row', async () => {
        const repository = fakeRepository([claimed]);
        const { worker, provider } = workerFor(repository);

        await worker.runOnce();

        expect(provider.sent).toHaveLength(1);
        // covers: mail:I-05 — a delivered row is deleted, never stamped: it
        // carries an account-takeover secret and has outlived its only purpose.
        expect(repository.markDelivered).toHaveBeenCalledWith('delivery-1');
        expect(repository.markRetrying).not.toHaveBeenCalled();
    });

    it('sends the body exactly as it was stored, with the configured sender', async () => {
        const repository = fakeRepository([claimed]);
        const { worker, provider } = workerFor(repository, undefined, {
            appUrl: 'https://cms.example.com',
            from: 'Ortha <no-reply@example.com>',
            replyTo: 'support@example.com'
        });

        await worker.runOnce();

        // covers: mail:I-06 — the rendered body is re-sent, never regenerated,
        // so a duplicate carries the same working link as the first copy.
        expect(provider.last()).toMatchObject({
            to: 'ada@example.com',
            from: 'Ortha <no-reply@example.com>',
            replyTo: 'support@example.com',
            subject: 'You have been invited',
            text: claimed.bodyText,
            html: '<p>link</p>',
            headers: { 'X-Ortha-Mail-Kind': 'invite' }
        });
    });

    it('backs off and keeps the row when the relay is merely unavailable', async () => {
        const repository = fakeRepository([claimed]);
        const { worker, provider } = workerFor(repository);
        provider.failNext(1, 'connection refused');

        await worker.runOnce();

        expect(repository.markDead).not.toHaveBeenCalled();
        expect(repository.markRetrying).toHaveBeenCalledWith(
            'delivery-1',
            expect.stringContaining('connection refused'),
            // Scheduled, not immediate: the backoff is what keeps a relay that
            // is merely down from being hammered for the message's whole life.
            expect.any(Date),
            'testkit'
        );
        const scheduled = repository.markRetrying.mock.calls[0]?.[2] as Date;
        expect(scheduled.getTime()).toBeGreaterThan(Date.now());
    });

    it('stops a permanently rejected message at once, budget untouched', async () => {
        const repository = fakeRepository([claimed]);
        const { worker, provider } = workerFor(repository);
        provider.failPermanently('550 5.1.1 unknown recipient');

        await worker.runOnce();

        // covers: mail:I-08 — a typo'd address must not spend five attempts and
        // land in the dead letters beside a real outage.
        expect(repository.markRetrying).not.toHaveBeenCalled();
        expect(repository.markDead).toHaveBeenCalledWith(
            'delivery-1',
            expect.stringContaining('unknown recipient'),
            'testkit'
        );
    });

    it('gives up when the attempt budget is spent', async () => {
        const repository = fakeRepository([{ ...claimed, attempts: 4 }]);
        const { worker, provider } = workerFor(repository, undefined, {
            appUrl: 'https://cms.example.com',
            from: 'no-reply@example.com',
            maxAttempts: 5
        });
        provider.failNext(1, 'connection refused');

        await worker.runOnce();

        expect(repository.markDead).toHaveBeenCalledWith(
            'delivery-1',
            expect.stringContaining('Gave up after 5 attempts'),
            'testkit'
        );
    });

    it('claims the batch size it was configured with, and leases it', async () => {
        const repository = fakeRepository();
        const { worker } = workerFor(repository, undefined, {
            appUrl: 'https://cms.example.com',
            from: 'no-reply@example.com',
            batchSize: 7,
            claimLeaseMs: 30_000
        });

        await worker.runOnce();

        expect(repository.claim).toHaveBeenCalledWith(7, 30_000);
    });

    it('sweeps expired messages once per interval, not every tick', async () => {
        const repository = fakeRepository();
        const { worker } = workerFor(repository, undefined, {
            appUrl: 'https://cms.example.com',
            from: 'no-reply@example.com',
            sweepIntervalMs: 60_000
        });

        await worker.runOnce();
        await worker.runOnce();

        // covers: mail:I-07 — the sweep is the only thing that can remove a
        // message whose link has expired, and it runs on its own cadence.
        expect(repository.sweepExpired).toHaveBeenCalledTimes(1);
    });

    it('survives a tick that throws, so the interval keeps running', async () => {
        const repository = fakeRepository();
        repository.claim.mockRejectedValueOnce(new Error('database is down'));
        const { worker } = workerFor(repository);

        await expect(worker.runOnce()).resolves.toBeUndefined();
    });

    it('arms nothing when sending is switched off in this process', async () => {
        const repository = fakeRepository([claimed]);
        const { worker, provider } = workerFor(repository, undefined, {
            appUrl: 'https://cms.example.com',
            from: 'no-reply@example.com',
            deliveryIntervalMs: 0
        });

        worker.onApplicationBootstrap();
        await worker.onModuleDestroy();

        // Rows still queue — a deployment can run the API here and the sender
        // somewhere else — but this process sends nothing.
        expect(provider.sent).toHaveLength(0);
        expect(repository.claim).not.toHaveBeenCalled();
    });
});
