import type { AgentOptionsEntry } from 'kiao-worker';


/** What joins a model and an effort into the one value the select holds. */
export const MODEL_EFFORT_SEP = ':';

export interface ModelEffortDefault {
    model: string;
    effort: string;
}

/** The pair the toolbar shows until a conversation is selected, and the settings the next one is. */
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

/** Model IDs may contain colons (for example local model tags); effort is the final segment. */
export const splitModelEffort = (value: string): ModelEffortDefault => {
    const at = value.lastIndexOf(MODEL_EFFORT_SEP);
    return at < 0 ? { model: value, effort: '' } : { model: value.slice(0, at), effort: value.slice(at + 1) };
};
