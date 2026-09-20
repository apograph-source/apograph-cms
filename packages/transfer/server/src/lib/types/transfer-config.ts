/**
 * What a deployment gets to decide about transfers.
 *
 * Both settings exist because the sensible value is deployment-specific and the
 * wrong one is quietly bad: an identity field derived from the schema is a
 * guess that works until it doesn't, and a limit tuned for a blog is wrong for
 * a catalogue.
 */

import type { TransferLimits } from '@orthacms/transfer-domain';

/** Options for `TransferPlugin`. */
export interface TransferPluginConfig {
    /**
     * Which fields identify a record of each type, keyed by type name.
     *
     * This is the setting worth getting right. Everything an import does rests
     * on being able to say "this incoming record is that existing row", and the
     * derived fallback (see `resolveIdentityFields`) is a heuristic: it prefers
     * a field *named* like an identifier, then the first required text field.
     * A catalogue keyed on `sku` and a members list keyed on `email` should say
     * so here rather than hope the heuristic agrees.
     *
     * A type left out falls back to the derived choice, which is reported in
     * every export's manifest, so what an import matched on is never a secret.
     *
     * @example
     * ```typescript
     * identity: { product: ['sku'], author: ['email'], page: ['slug'] }
     * ```
     */
    identity?: Record<string, readonly string[]>;
    /**
     * Ceilings on one transfer. Omitted keys keep the shipped defaults.
     *
     * Raise `maxEntries` / `maxBytes` for a deliberate bulk migration; the
     * import-side archive limits are a safety boundary rather than a capacity
     * setting, and lowering them costs nothing.
     */
    limits?: Partial<TransferLimits>;
}
