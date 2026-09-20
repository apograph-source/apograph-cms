import {
    Controller,
    Get,
    Inject,
    NotFoundException,
    Param,
    ParseUUIDPipe,
    Query,
    Res,
    StreamableFile,
    UseGuards
} from '@nestjs/common';
import type { Response } from 'express';
import {
    CurrentUser,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@orthacms/identity-server';
import { MembershipCheckQuery } from '@orthacms/workspaces-server';
import { STORAGE_PROVIDER, type StorageProvider } from '@orthacms/media-domain';
import { DownloadAssetQuery } from '../../infrastructure/queries/download-asset.query';
import { downloadHeadersFor } from '../download-headers';
import {
    DIRECT_SERVE,
    directUrlFor,
    type DirectServeConfig
} from '../direct-serve';
import { toHttp } from '../to-http';

/**
 * `GET /api/media/assets/:id/raw` — streams an asset's bytes from the provider
 * that holds them. Stays behind the app's auth + `media:read` (media is private
 * by default).
 *
 * **This is the one media route without `WorkspaceGuard`,** deliberately: the
 * URL is consumed by the browser itself — `<img src>` in the library's
 * thumbnails and detail drawer, plus download links — and those requests carry
 * cookies but *cannot* carry the `X-Workspace-Id` header the guard demands, so
 * every preview 400'd. The scope isn't dropped, it's **derived**: an asset id
 * already determines its workspace, so we look the row up, then require the
 * caller to be a member of *that* workspace. Same boundary, one fewer thing the
 * client has to assert.
 */
@UseGuards(PermissionsGuard)
@RequirePermissions(PERMISSIONS.MEDIA_READ)
@Controller('media')
export class DownloadAssetController {
    constructor(
        private readonly query: DownloadAssetQuery,
        private readonly members: MembershipCheckQuery,
        @Inject(STORAGE_PROVIDER) private readonly provider: StorageProvider,
        @Inject(DIRECT_SERVE) private readonly directServe: DirectServeConfig
    ) {}

    /**
     * Streams one asset's bytes. `?variant=thumb|preview` serves a generated
     * derivative when present, else the original.
     *
     * The stored MIME type is the uploader's own claim — nothing sniffs the
     * bytes — so the response is hardened by {@link downloadHeadersFor}: always
     * `nosniff` + a no-capability CSP, and `inline` only for types a browser
     * renders without executing them. See `http/download-headers.ts`.
     */
    @Get('assets/:id/raw')
    async raw(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: PublicUser,
        @Res({ passthrough: true }) response: Response,
        @Query('variant') variant?: string
    ): Promise<StreamableFile | undefined> {
        const location = await this.query.locate(id, variant);
        // A non-member gets the same 404 as a missing asset — distinguishing
        // them would let anyone probe which asset ids exist in other workspaces.
        if (
            !location ||
            !(await this.members.isMember(user.id, location.workspaceId))
        ) {
            throw new NotFoundException();
        }

        // Direct serve, when the deployment asked for it and the backend can
        // mint a URL. It runs **after** the authorization above, never instead
        // of it, and the disposition it pins onto that URL is decided by the
        // same `isInlineSafe` the proxied path uses — a redirect discards this
        // response's own `Content-Disposition`, `nosniff` and CSP, so an
        // uploaded `.html` must still arrive as an attachment.
        //
        // `no-store` because the URL expires: a shared cache holding this
        // redirect would serve a signed URL past its lifetime, which is a 403
        // for the next viewer rather than a picture.
        const signed = await directUrlFor(
            this.provider,
            this.directServe,
            location
        );
        if (signed) {
            response.set({ 'Cache-Control': 'private, no-store' });
            response.redirect(302, signed);
            return undefined;
        }

        // Through `toHttp`, so a row whose blob is gone from storage — a
        // database restored against an empty volume, a hand-reclaimed blob, an
        // interrupted migration — is the same 404 as a missing asset rather
        // than a 500. A 500 there was both wrong and a signal: it told a
        // caller the row was real. Anything else is rethrown and stays a 500.
        const stream = await this.query
            .open(location)
            .catch((error: unknown) => toHttp(error));
        const { disposition, headers } = downloadHeadersFor(
            location.mimeType,
            location.name
        );
        response.set(headers);
        return new StreamableFile(stream, {
            type: location.mimeType,
            disposition,
            length: location.size
        });
    }
}
