import { useQuery } from '@tanstack/react-query';
import {
    apiClient,
    HTTP_STATUS,
    STALE_TIME,
    toApiError
} from '@orthacms/utils-admin';

/** One selectable backend: a registered provider plus one of its models. */
export interface CopilotModelChoice {
    /** The provider's registered name, e.g. `claude` or `ollama`. */
    provider: string;
    /** A model id that provider offers. */
    model: string;
}

/**
 * What `GET /api/copilot/models` returns.
 *
 * The order is the only default there is: `items[0]` is the first registered
 * provider's first model, which is what a run naming neither is served by, and
 * what every chat opens on. The server used to send a `defaultProvider`
 * alongside this list and no client ever read it — a second source of truth for
 * something the list already says.
 */
export interface CopilotModelCatalogue {
    items: CopilotModelChoice[];
}

/** Query key for the model catalogue. */
export const copilotModelsKey = ['copilot', 'models'] as const;

/**
 * The backends a run may choose from.
 *
 * `STALE_TIME.Forever`: the registry is built at boot from `plugins.ts` and
 * cannot change while the tab is open, so refetching it would only add
 * requests. A deployment that adds a provider requires a restart, which the
 * user's next page load picks up anyway.
 *
 * `enabled` exists for {@link useCopilotAvailable}, which runs on every admin
 * page rather than only inside a chat: a user without `copilot:use` should not
 * spend a request per session on a catalogue they are not allowed to read.
 */
export function useCopilotModels(options: { enabled?: boolean } = {}) {
    return useQuery({
        queryKey: copilotModelsKey,
        staleTime: STALE_TIME.Forever,
        enabled: options.enabled ?? true,
        queryFn: async (): Promise<CopilotModelCatalogue> => {
            const response =
                await apiClient.get<CopilotModelCatalogue>('/copilot/models');
            return response.data;
        }
    });
}

/**
 * Whether this deployment runs the copilot at all.
 *
 * The switch is the operator's `COPILOT_ENABLED`, and it is answered by the
 * **routes themselves**: `CopilotModule.forRoot` registers no controller when
 * it is off, so the catalogue 404s along with everything else under
 * `/api/copilot`. There is no separate capability endpoint to keep in step with
 * it — a deployment that cannot serve a model list cannot serve a run either,
 * which is exactly the question every surface here is asking.
 *
 * **Only an explicit `404` counts as off**, and every other outcome — still
 * loading, a network blip, a `5xx`, a `403` for a user who may not read the
 * catalogue — leaves the surfaces up. The server is the authority either way
 * (the route 404s regardless of what this decides), so being wrong in this
 * direction costs a control that answers "not found", while being wrong in the
 * other would make a transient failure look like a feature the operator
 * removed. A 404 is not retried by the shared client, so this settles on the
 * first response.
 */
export function useCopilotAvailable(
    options: { enabled?: boolean } = {}
): boolean {
    const { error } = useCopilotModels(options);
    return !copilotIsOff(error);
}

/**
 * The rule {@link useCopilotAvailable} applies, as a function — pure, so the
 * cases that matter are unit-tested rather than driven through a query.
 *
 * Only a `404` from the catalogue says the deployment turned the copilot off.
 * `null` (no error) is the ordinary answer, and so are a still-loading query, a
 * transport failure and a `5xx`: none of them is the operator's decision, and
 * reading them as one would make a blip look like a removed feature.
 */
export function copilotIsOff(error: unknown): boolean {
    if (!error) {
        return false;
    }
    return toApiError(error).status === HTTP_STATUS.NOT_FOUND;
}

/** A stable string key for one choice, for use as a select value. */
export function modelChoiceKey(choice: CopilotModelChoice): string {
    return `${choice.provider}:${choice.model}`;
}

/**
 * The backend a chat runs on: what somebody picked, or the **first entry in
 * the catalogue** until they do.
 *
 * That fallback is the client half of dropping `defaultProvider`. A chat used
 * to open on "Default" — an option meaning "whatever the host's resolver
 * picks", which named no model and showed the person nothing about what was
 * going to answer them. Now the picker opens on a real row, and the turn is
 * sent naming it, so what the header says is what runs.
 *
 * Derived rather than seeded into the session on open: the catalogue is a
 * query, so at the moment a chat opens there may be nothing to seed *from*, and
 * an effect that filled it in later would race the model a saved thread was
 * left on. It is also, deliberately, **not a pick** — nothing is written back
 * to the thread until somebody touches the picker (see `choicePinned`).
 */
export function useEffectiveModelChoice(
    choice: CopilotModelChoice | null
): CopilotModelChoice | null {
    const { data } = useCopilotModels();
    return choice ?? data?.items[0] ?? null;
}

/**
 * How a thread recorded "the host's resolver picks" before there was anything
 * else to record.
 *
 * Kept for **reading old rows only**. It was written when "Default" was a
 * selectable option; it no longer is, so nothing produces this value any more,
 * and a thread carrying it reads back as "nobody picked here" — which lands the
 * chat on the first catalogue entry, exactly like a thread that never had one.
 * It contains no colon, which is what keeps it unambiguous against a
 * {@link modelChoiceKey}.
 */
export const DEFAULT_MODEL_CHOICE = 'default';

/**
 * A choice in the form the thread stores it — `PATCH /copilot/conversations/:id`
 * and `ConversationView.modelChoice` both speak this.
 *
 * The *absence* of a stored value is `null` on the wire and means "nobody has
 * picked on this thread"; this function never produces it, because a caller
 * only writes what somebody chose.
 */
export function storedModelChoice(choice: CopilotModelChoice): string {
    return modelChoiceKey(choice);
}

/**
 * The stored form back into a choice. Pass only a value the server actually
 * carried — `null` there means "never picked", which the caller handles by
 * leaving the chat on whatever seeded it.
 */
export function readStoredModelChoice(
    stored: string
): CopilotModelChoice | null {
    return stored === DEFAULT_MODEL_CHOICE ? null : parseModelChoiceKey(stored);
}

/** Parses a {@link modelChoiceKey} back into a choice. */
export function parseModelChoiceKey(key: string): CopilotModelChoice | null {
    // Split on the FIRST colon only: provider names can't contain one (the
    // registry rejects blanks and duplicates but not colons), while model ids
    // routinely do — `llama3.1:8b`, `qwen2.5:14b-instruct`.
    const separator = key.indexOf(':');
    if (separator <= 0 || separator === key.length - 1) {
        return null;
    }
    return {
        provider: key.slice(0, separator),
        model: key.slice(separator + 1)
    };
}
