import { HTTP_STATUS } from '@orthacms/utils-admin';
import {
    copilotIsOff,
    DEFAULT_MODEL_CHOICE,
    modelChoiceKey,
    parseModelChoiceKey,
    readStoredModelChoice,
    storedModelChoice
} from './useCopilotModels';

describe('model choice keys', () => {
    it('round-trips a plain choice', () => {
        const choice = { provider: 'claude', model: 'claude-opus-5' };

        expect(parseModelChoiceKey(modelChoiceKey(choice))).toEqual(choice);
    });

    // The case a naive `split(':')` gets wrong: Ollama and friends put a colon
    // in the model id itself, so only the FIRST one separates the two halves.
    it('round-trips a model id containing colons', () => {
        const choice = { provider: 'ollama', model: 'llama3.1:8b-instruct' };

        expect(parseModelChoiceKey(modelChoiceKey(choice))).toEqual(choice);
    });

    it('rejects a key with no separator', () => {
        expect(parseModelChoiceKey('claude')).toBeNull();
    });

    it('rejects a key with an empty half', () => {
        expect(parseModelChoiceKey(':model')).toBeNull();
        expect(parseModelChoiceKey('provider:')).toBeNull();
    });
});

/**
 * The form a **thread** remembers its model in. Only a real backend is ever
 * written now — "Default" was retired with the `defaultProvider` setting it
 * stood for — but rows written before that still carry the sentinel, and
 * reading one has to land somewhere sensible rather than on half a key.
 */
describe('the stored model choice', () => {
    it('round-trips a concrete backend', () => {
        const choice = { provider: 'anthropic', model: 'claude-opus-5' };

        expect(readStoredModelChoice(storedModelChoice(choice))).toEqual(
            choice
        );
    });

    it('round-trips a model id containing colons', () => {
        const choice = { provider: 'ollama', model: 'llama3.1:8b' };

        expect(readStoredModelChoice(storedModelChoice(choice))).toEqual(
            choice
        );
    });

    it('reads an old Default row back as no choice', () => {
        // Which leaves the chat on the catalogue's first entry, exactly like a
        // thread nobody ever picked on — see `useEffectiveModelChoice`.
        expect(readStoredModelChoice(DEFAULT_MODEL_CHOICE)).toBeNull();
    });

    it('keeps the sentinel unambiguous — it has no separator', () => {
        // Which is the whole reason one nullable text column can carry three
        // states: any real key contains a colon, and `'default'` cannot.
        expect(DEFAULT_MODEL_CHOICE).not.toContain(':');
        expect(parseModelChoiceKey(DEFAULT_MODEL_CHOICE)).toBeNull();
    });

    it('reads a malformed stored value as no choice rather than half of one', () => {
        // A row written by an older client, or by hand. Falling back to the
        // resolver is the only safe reading; half a choice is not a backend.
        expect(readStoredModelChoice('anthropic')).toBeNull();
        expect(readStoredModelChoice(':claude-opus-5')).toBeNull();
    });
});

/**
 * Whether the deployment runs the copilot at all, read off the catalogue's own
 * failure. The switch is the operator's `COPILOT_ENABLED`, and it is answered
 * by the routes: with it off `CopilotModule.forRoot` registers no controller,
 * so `GET /copilot/models` 404s along with everything else under
 * `/api/copilot`.
 */
describe('copilotIsOff', () => {
    /** An axios-shaped rejection, as the query hands it over. */
    const failure = (status: number) => ({
        isAxiosError: true,
        response: { status },
        message: `Request failed with status ${status}`
    });

    it('is not off while the catalogue is loading or has answered', () => {
        expect(copilotIsOff(null)).toBe(false);
        expect(copilotIsOff(undefined)).toBe(false);
    });

    it('is off on a 404 — the routes are not registered [copilot:I-40]', () => {
        expect(copilotIsOff(failure(HTTP_STATUS.NOT_FOUND))).toBe(true);
    });

    // The direction that matters: a deployment whose copilot is on must not
    // have its surfaces taken away by a blip or a permission answer. Every one
    // of these leaves the launcher, the switcher and the page up, and the
    // server still refuses whatever it was going to refuse.
    it('is not off for any other failure [copilot:I-40]', () => {
        expect(copilotIsOff(failure(HTTP_STATUS.FORBIDDEN))).toBe(false);
        expect(copilotIsOff(failure(500))).toBe(false);
        expect(copilotIsOff(new TypeError('Failed to fetch'))).toBe(false);
    });
});
