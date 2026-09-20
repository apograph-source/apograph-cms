import {
    DEFAULT_MAIL_TEMPLATES,
    escapeHtml,
    formatExpiry,
    type MailTemplateContext
} from './templates';
import { MAIL_KINDS } from './mail-dispatcher';

const context: MailTemplateContext = {
    recipientName: 'Ada Lovelace',
    recipientEmail: 'ada@example.com',
    actorName: 'Grace Hopper',
    link: 'https://cms.example.com/identity/accept-invite?token=s3cret',
    expiresAt: new Date('2026-09-20T08:30:00.000Z'),
    productName: 'Ortha'
};

describe('the shipped templates', () => {
    it('cover every kind the dispatcher can queue, and no other', () => {
        expect(Object.keys(DEFAULT_MAIL_TEMPLATES).sort()).toEqual(
            Object.values(MAIL_KINDS).sort()
        );
    });

    it.each(Object.values(MAIL_KINDS))(
        '%s renders a text part carrying the link',
        (kind) => {
            const rendered = DEFAULT_MAIL_TEMPLATES[kind](context);
            expect(rendered.subject).toBeTruthy();
            // `text` is mandatory and `html` optional in that order: a plain
            // part always renders, wherever the message is opened.
            expect(rendered.text).toContain(context.link);
            expect(rendered.html).toContain(context.link);
        }
    );

    it.each(Object.values(MAIL_KINDS))(
        '%s names when the link dies',
        (kind) => {
            expect(DEFAULT_MAIL_TEMPLATES[kind](context).text).toContain(
                '20 September 2026'
            );
        }
    );

    it('greets a member who has no name without an empty gap', () => {
        const rendered = DEFAULT_MAIL_TEMPLATES.invite({
            ...context,
            recipientName: null
        });
        expect(rendered.text).toContain('Hello,');
        expect(rendered.text).not.toContain('Hello ,');
    });

    it('says who invited them when the actor is known', () => {
        expect(DEFAULT_MAIL_TEMPLATES.invite(context).text).toContain(
            'Grace Hopper has invited you'
        );
        expect(
            DEFAULT_MAIL_TEMPLATES.invite({ ...context, actorName: null }).text
        ).toContain('Somebody has invited you');
    });

    it('tells a resend recipient that the earlier link is dead', () => {
        // The one fact that distinguishes this message from the first: the
        // rotation killed the link still sitting in their inbox.
        expect(DEFAULT_MAIL_TEMPLATES.invite_resent(context).text).toContain(
            'stopped working'
        );
    });

    it('escapes a name that would otherwise be markup in the HTML part', () => {
        const rendered = DEFAULT_MAIL_TEMPLATES.invite({
            ...context,
            recipientName: '<script>alert(1)</script>'
        });
        expect(rendered.html).not.toContain('<script>');
        expect(rendered.html).toContain('&lt;script&gt;');
    });
});

describe('formatExpiry', () => {
    it('names the zone it rendered, because it is not the reader’s', () => {
        expect(formatExpiry(new Date('2026-09-20T08:30:00.000Z'))).toBe(
            '20 September 2026 at 08:30'
        );
    });
});

describe('escapeHtml', () => {
    it('covers the five characters that matter in a body', () => {
        expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;');
    });
});
