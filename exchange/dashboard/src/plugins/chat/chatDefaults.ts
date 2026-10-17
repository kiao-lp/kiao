import type { AgentOptionsEntry } from 'kiao-worker';

// ── The model and effort a new conversation starts with ──────────────────────
//
// The service advertises its own pair per agent (`defaultModel`/`defaultEffort` on the entry) —
// the same pair a create that names neither stores, so the toolbar and the starters above it
// agree. What this file adds is only the fallback for an agent with no opinion, and the check
// that the advertised pair is one the lists beside it actually offer.

/** What joins a model and an effort into the one value the select holds. */
export const MODEL_EFFORT_SEP = ':';

export interface ModelEffortDefault {
    model: string;
    effort: string;
}

/**
 * The pair the toolbar shows until a conversation is selected, and the settings the next one is
 * created with. The advertised pair wins where it is one of the offered choices; anything else —
 * an agent with no opinion, a service too old to advertise one, a pair the lists no longer hold —
 * falls back to cheapest model + lightest effort, which is the choice that spends the least on a
 * conversation nobody has looked at yet.
 */
export const defaultModelEffortFor = (entry: AgentOptionsEntry): ModelEffortDefault => {
    const models = entry.models ?? [];
    const efforts = entry.efforts ?? [];
    const advertisedModel = entry.defaultModel ?? '';
    const advertisedEffort = entry.defaultEffort ?? '';
    return {
        model: advertisedModel && models.some(option => option.value === advertisedModel)
            ? advertisedModel
            : models.find(option => option.value === 'haiku')?.value
                ?? models[models.length - 1]?.value ?? '',
        effort: advertisedEffort && efforts.some(option => option.value === advertisedEffort)
            ? advertisedEffort
            : efforts.find(option => option.value === 'low')?.value
                ?? efforts[0]?.value ?? '',
    };
};
