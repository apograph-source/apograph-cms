/** Export/import — the per-type identity fields and the transfer ceilings. */
import type { TransferPluginConfig } from '@orthacms/transfer-server';

/** Export/import — the per-type identity fields and the transfer ceilings. */
export function transferConfig(): TransferPluginConfig {
    return {
        // Which field identifies a record of each type, per content type.
        //
        // This is the setting that decides whether importing the same file
        // twice updates the records or duplicates them. Left out, a type falls
        // back to a derived guess — a field *named* like an identifier (`slug`,
        // `sku`, `email`), then the first required text field — which is usually
        // right and is reported in every export's manifest, but is still a
        // guess. Name the fields for any type where being wrong would be
        // expensive:
        //
        //   identity: { product: ['sku'], author: ['email'] }
        //
        // The shipped template registers no content types, so there is nothing
        // to key here yet.
        identity: {},
        // Ceilings on one transfer. The defaults (see
        // `DEFAULT_TRANSFER_LIMITS`) sit comfortably above real editorial work
        // and far below "the whole library"; the import-side archive limits are
        // a safety boundary rather than a capacity setting, so lowering them
        // costs nothing and raising them should be deliberate.
        limits: {}
    };
}
