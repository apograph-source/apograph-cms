import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { IdentityPluginConfig } from '../../types';
import { InjectIdentityConfig } from '../../identity.tokens';

/** Name of the opaque session cookie. */
export const SESSION_COOKIE = 'ortha_session';

/**
 * Name of the short-lived cookie that ties a browser to one in-flight SSO
 * sign-in attempt. Holds an opaque token; everything else about the attempt
 * lives in `sso_auth_requests`.
 */
export const SSO_REQUEST_COOKIE = 'ortha_sso_request';

/**
 * Owns the session cookie's transport concerns so domain services stay free of
 * `req`/`res`. Reads its attributes from config, so call sites never pass them.
 */
@Injectable()
export class CookieService {
    constructor(
        @InjectIdentityConfig() private readonly config: IdentityPluginConfig
    ) {}

    /**
     * Writes the session cookie. Attributes and lifetime come from config
     * (`secure`/`sameSite`/TTL), never literals. The value is the opaque
     * session token; the cookie is unsigned because validity is the
     * per-request DB lookup.
     */
    setSession(res: Response, token: string): void {
        const { session } = this.config;
        res.cookie(SESSION_COOKIE, token, {
            httpOnly: true,
            secure: session.cookieSecure,
            sameSite: session.cookieSameSite,
            maxAge: session.ttlSeconds * 1000,
            path: '/'
        });
    }

    /**
     * Clears the session cookie on logout. Mirrors {@link setSession}'s
     * attributes (`secure`/`sameSite`/`path`) so the browser matches the cookie
     * and drops it; the value is emptied and the expiry pushed to the past.
     */
    clearSession(res: Response): void {
        const { session } = this.config;
        res.clearCookie(SESSION_COOKIE, {
            httpOnly: true,
            secure: session.cookieSecure,
            sameSite: session.cookieSameSite,
            path: '/'
        });
    }

    /**
     * Extracts the session token from the raw `Cookie` header, or `null` when
     * absent. Hand-rolled (no `cookie-parser`) to keep the auth feature
     * self-contained; the auth-guard ticket owns request-side session
     * middleware.
     */
    readSession(req: Request): string | null {
        return this.read(req, SESSION_COOKIE);
    }

    /**
     * Writes the SSO attempt cookie: the opaque handle that ties this browser
     * to the `sso_auth_requests` row holding the attempt's `state`, `nonce` and
     * PKCE verifier.
     *
     * **`sameSite` is always `lax` here, never the configured value.** The
     * identity provider returns the person with a top-level cross-site
     * navigation, and a `strict` cookie is not sent on one — the callback would
     * find no attempt and every sign-in would fail with a generic error. `lax`
     * is exactly the case this attribute was designed for, and the attempt is
     * still one-time, minutes-long, and useless without the matching `state`.
     * (`IdentityPlugin` refuses to boot with SSO providers and a `strict`
     * session cookie, so the two can never disagree in a live deployment.)
     *
     * The path is narrowed to the SSO routes: nothing outside them reads this,
     * and a cookie sent on every request is one more thing in every log.
     */
    setSsoRequest(res: Response, token: string, expiresAt: Date): void {
        res.cookie(SSO_REQUEST_COOKIE, token, {
            httpOnly: true,
            secure: this.config.session.cookieSecure,
            sameSite: 'lax',
            expires: expiresAt,
            path: this.ssoCookiePath()
        });
    }

    /** The attempt token from the raw `Cookie` header, or `null`. */
    readSsoRequest(req: Request): string | null {
        return this.read(req, SSO_REQUEST_COOKIE);
    }

    /**
     * Clears the SSO attempt cookie. Called on **both** outcomes: an attempt is
     * one-time, so leaving the cookie behind after a failure would send a stale
     * handle on every later attempt and make one confusing failure look like a
     * broken provider.
     */
    clearSsoRequest(res: Response): void {
        res.clearCookie(SSO_REQUEST_COOKIE, {
            httpOnly: true,
            secure: this.config.session.cookieSecure,
            sameSite: 'lax',
            path: this.ssoCookiePath()
        });
    }

    /** Where the SSO routes live — the scope the attempt cookie is sent on. */
    private ssoCookiePath(): string {
        const prefix = this.config.sso?.apiPathPrefix ?? '/api';
        return `${prefix}/auth/sso`;
    }

    /** Reads one cookie out of the raw header, or `null` when it is absent. */
    private read(req: Request, name: string): string | null {
        const header = req.headers.cookie;
        if (!header) {
            return null;
        }
        for (const part of header.split(';')) {
            const eq = part.indexOf('=');
            if (eq === -1) {
                continue;
            }
            if (part.slice(0, eq).trim() === name) {
                return part.slice(eq + 1).trim() || null;
            }
        }
        return null;
    }
}
