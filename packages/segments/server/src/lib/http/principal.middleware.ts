import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { AuthenticatedRequest } from '@orthacms/identity-server';
import type { NextFunction, Response } from 'express';
import { PrincipalStore } from '../application/principal.store';

/**
 * Puts the current request in scope for the rest of it, so the entry-write
 * extension can ask who is acting.
 *
 * Middleware for the reason `ReaderMiddleware` is: `AsyncLocalStorage.run` has
 * to *wrap* everything that follows, and only middleware is positioned to
 * arrange that. Unlike that one it never short-circuits — the reader resolution
 * is skippable when no segment exists, but a permission check that silently
 * stopped running would be the failure nobody notices.
 */
@Injectable()
export class PrincipalMiddleware implements NestMiddleware {
    constructor(private readonly store: PrincipalStore) {}

    use(
        request: AuthenticatedRequest,
        response: Response,
        next: NextFunction
    ): void {
        this.store.run(request, () => next());
    }
}
