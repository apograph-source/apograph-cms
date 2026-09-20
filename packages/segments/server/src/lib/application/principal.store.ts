import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type {
    AuthenticatedRequest,
    PublicUser
} from '@orthacms/identity-server';

/**
 * Who is **acting** on the current request — the counterpart of
 * {@link ReaderStore}, which is who is *reading*.
 *
 * It exists for one caller: the entry-write extension. Access is applied inside
 * the entry save's transaction, from a singleton reached through content's
 * writer, so there is no request in hand at the point the permission has to be
 * checked — and it has to be checked there, because the save's own gate is
 * `content:update`, which is not the same authority as `segments:manage`.
 *
 * **It stores the request, not the user.** Middleware is the only thing
 * positioned to wrap the rest of the request in `AsyncLocalStorage.run`, and it
 * runs *before* the guards that resolve `request.user`. Holding the request
 * object is what bridges that: the guard mutates the same object in place, so by
 * the time a controller (and therefore the write) runs, `user` is there.
 *
 * **Absence is nobody, and nobody is refused.** A code path the middleware did
 * not cover cannot prove it may change who reads an entry, so it may not — the
 * same fail-closed default the reader side takes, pointing the other way.
 */
@Injectable()
export class PrincipalStore {
    private readonly storage = new AsyncLocalStorage<AuthenticatedRequest>();

    /** Run `fn` with `request` in scope. */
    run<T>(request: AuthenticatedRequest, fn: () => T): T {
        return this.storage.run(request, fn);
    }

    /**
     * The acting user, or `undefined` — read at call time rather than at `run`
     * time, because that is when the guards have finished putting it there.
     */
    current(): PublicUser | undefined {
        return this.storage.getStore()?.user;
    }
}
