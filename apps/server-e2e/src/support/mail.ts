import type { INestApplication } from '@nestjs/common';
import {
    createTestkitMailProvider,
    type TestkitMailProvider
} from '@apograph/mail-provider-testkit';
import { MailDeliveryWorker } from '@apograph/mail-server';

/**
 * The capturing mail backend the harness boots with, when a suite asks for one.
 *
 * Module-scoped, like the scripted SSO and copilot providers: the plugin takes
 * **one** constructed provider, so the suite needs the same object the app is
 * holding in order to read what it was handed. {@link resetMail} clears it
 * between tests — one instance for the run, not one per boot.
 */
export const testMailProvider: TestkitMailProvider = createTestkitMailProvider({
    id: 'testkit'
});

/** Forgets every captured message and any scripted failure. */
export function resetMail(): void {
    testMailProvider.reset();
}

/**
 * Runs the sender once and returns what the provider was handed.
 *
 * The worker's timer is off in the harness (`deliveryIntervalMs: 0`), so
 * nothing leaves the queue until a test says so — which is what makes "the row
 * is still there, unsent" and "the row is gone, it went out" two states a suite
 * can tell apart.
 */
export async function drainMail(
    app: INestApplication
): Promise<TestkitMailProvider['sent']> {
    await app.get(MailDeliveryWorker).runOnce();
    return testMailProvider.sent;
}
