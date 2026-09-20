/**
 * `@ortha/mail-provider-console` — the offline mail adapter.
 *
 * Writes every message to the log instead of sending it, so a development
 * install can read an invitation link without a mail server. Installed
 * unconditionally by `create-ortha-app`, offered by no picker and registered
 * by no template: a scripted adapter that reached a real deployment would make
 * invitations *look* sent and be read by nobody.
 */

export {
    createConsoleMailProvider,
    type ConsoleMailProviderOptions,
    type ConsoleMailSink
} from './lib/console-mail-provider';
