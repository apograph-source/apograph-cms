/**
 * The one table this plugin owns, and the barrel `drizzle.config.ts` points at.
 *
 * One table is the whole data model: a dead letter is a row that was given up
 * on, so the queue and the failure log are the same rows read with a different
 * predicate.
 */

export { mailDeliveries } from './mail-deliveries';
