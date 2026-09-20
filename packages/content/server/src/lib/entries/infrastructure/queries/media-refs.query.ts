import { Injectable, Optional } from '@nestjs/common';
import { toMediaValueRef, type MediaValueRef } from '@orthacms/content-domain';
import type { AnyContentType } from '../../../types/content-type';
import { CONTENT_FIELD_TYPE } from '../../../types/fields';
import {
    InjectMediaAssetResolver,
    type MediaAssetResolver
} from '../../../extension/media-asset-resolver';
import type { MediaRef } from '../../types/entry-list-view';

/**
 * Resolves the media fields of a `values` bag to display refs — the assets the
 * admin renders (name / thumbnail url / kind) instead of raw uuids. One batched
 * resolver lookup across every media id; an asset that can't be resolved
 * (deleted / cross-workspace) is kept **in order** as an id-only `missing` ref,
 * so a `multiple` field's list never runs shorter than what was stored.
 *
 * Shared by the entry-editor read (`GET …/:id/media`, against the live row's
 * values) and the revision preview (against a snapshot's values), so the two
 * can't drift. A no-op returning `{}` when no media resolver is bound.
 */
@Injectable()
export class MediaRefsQuery {
    constructor(
        @Optional()
        @InjectMediaAssetResolver()
        private readonly resolver?: MediaAssetResolver
    ) {}

    /** Resolve every media field's ids in `values` to ordered {@link MediaRef}s. */
    async forValues(
        type: AnyContentType,
        values: Record<string, unknown>,
        workspaceId: string
    ): Promise<Record<string, MediaRef[]>> {
        const out: Record<string, MediaRef[]> = {};
        if (!this.resolver) return out;

        // The **refs**, not just the ids: a media value has carried a
        // per-usage `alt` and a `decorative` flag since `ORT-83`, and the whole
        // point of putting them on the value is that they override the asset
        // row's own description for *this* usage.
        const byField: Record<string, MediaValueRef[]> = {};
        const all = new Set<string>();
        for (const [name, spec] of Object.entries(type.fields)) {
            if (spec.type !== CONTENT_FIELD_TYPE.Media) continue;
            const value = values[name];
            const refs = (Array.isArray(value) ? value : [value])
                .map(toMediaValueRef)
                .filter(
                    (ref): ref is MediaValueRef => ref !== null && !!ref.id
                );
            if (!refs.length) continue;
            byField[name] = refs;
            for (const ref of refs) all.add(ref.id);
        }
        if (!all.size) return out;

        const resolved = await this.resolver.resolve([...all], workspaceId);
        for (const [name, refs] of Object.entries(byField)) {
            out[name] = refs.map((ref) => {
                const id = ref.id;
                const asset = resolved.get(id);
                return asset
                    ? {
                          id: asset.id,
                          name: asset.name,
                          url: asset.url,
                          // Only when the resolver has them — an asset with no
                          // derivative keeps the ref clean rather than carrying
                          // an undefined the admin has to test twice.
                          ...(asset.thumbUrl
                              ? { thumbUrl: asset.thumbUrl }
                              : {}),
                          ...(asset.previewUrl
                              ? { previewUrl: asset.previewUrl }
                              : {}),
                          kind: asset.kind,
                          mimeType: asset.mimeType,
                          // Per-usage wins over the asset's default, and
                          // `decorative` beats both: an image the author marked
                          // presentational *here* publishes with an empty `alt`
                          // however it is described in the library.
                          alt: usageAlt(ref, asset.alt),
                          ...(ref.decorative === true
                              ? { decorative: true }
                              : {})
                      }
                    : {
                          id,
                          name: id,
                          url: '',
                          kind: '',
                          mimeType: '',
                          missing: true
                      };
            });
        }
        return out;
    }
}

/**
 * The alt text this usage should publish with.
 *
 * `decorative` wins outright and resolves to an empty string — the value an
 * `<img alt="">` needs to be skipped by a screen reader, which is a different
 * claim from having no `alt` attribute at all. Otherwise a per-usage `alt`
 * overrides the asset row's default, and a usage that said nothing falls back to
 * it. Alt text is per usage, not per asset: the same logo is "Acme logo" in a
 * header and decorative in a footer strip (`ORT-83`).
 */
function usageAlt(ref: MediaValueRef, assetAlt: string | null): string | null {
    if (ref.decorative === true) return '';
    if (typeof ref.alt === 'string' && ref.alt.trim() !== '') return ref.alt;
    return assetAlt;
}
