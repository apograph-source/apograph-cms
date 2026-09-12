/**
 * How long an open review request waits before it reads as overdue.
 *
 * **One number, sent to whoever draws it.** It used to be a `3` here and a `3`
 * in `protection-admin`'s `RequestAge`, which is two constants that must agree
 * and nothing making them: moving this one to 7 left the reviews queue calling
 * five-day asks overdue while the Insights card said "waiting longer than 7
 * days", and every suite stayed green because each side tested against its own
 * copy. Both the card's summary and the queue page now carry it on the wire, so
 * the caption cannot come to sit over a figure counted against something else.
 *
 * It is a threshold for **presentation**, not a rule: nothing is refused,
 * escalated or swept because of it. That is why it lives beside the two reads
 * that report it rather than in the kernel, which decides who may publish.
 */
export const OVERDUE_AFTER_DAYS = 3;
