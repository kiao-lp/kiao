import { languages } from '../i18n/languages';


export type VoiceProvider = "google" | "azure";

export interface VoiceOption {
    /** Provider-prefixed id stored on the unit, e.g. "azure:fr-FR-DeniseNeural". */
    id: string;
    /** Display label (the bare, provider-native voice name). */
    label: string;
    provider: VoiceProvider;
}

// Google TTS voices per language (keyed by translation lang code). Chirp3-HD is Google's
// top tier (24 kHz) and is listed first; older Studio/Wavenet/Neural2/News voices follow.
const googleVoices: { [key: string]: string[] } = {
    "FR": ["fr-FR-Chirp3-HD-Puck", "fr-FR-Chirp3-HD-Aoede", "fr-FR-Chirp3-HD-Charon", "fr-FR-Chirp3-HD-Kore",
        "fr-FR-Chirp3-HD-Fenrir", "fr-FR-Chirp3-HD-Leda", "fr-FR-Chirp3-HD-Orus",
        "fr-FR-Studio-D", "fr-FR-Studio-A", "fr-FR-Wavenet-D", "fr-FR-Wavenet-E", "fr-FR-Neural2-F", "fr-FR-Neural2-G"],
    "EN": ["en-US-Chirp3-HD-Fenrir", "en-US-Chirp3-HD-Aoede", "en-US-Chirp3-HD-Charon", "en-US-Chirp3-HD-Kore", "en-US-Chirp3-HD-Puck", "en-US-Chirp3-HD-Leda",
        "en-GB-Chirp3-HD-Fenrir", "en-GB-Chirp3-HD-Aoede", "en-GB-Chirp3-HD-Charon", "en-GB-Chirp3-HD-Kore",
        "en-AU-Chirp3-HD-Aoede", "en-AU-Chirp3-HD-Charon", "en-AU-Chirp3-HD-Fenrir", "en-AU-Chirp3-HD-Kore",
        "en-GB-News-K", "en-GB-News-H"],
    "DE": ["de-DE-Chirp3-HD-Fenrir", "de-DE-Chirp3-HD-Aoede", "de-DE-Chirp3-HD-Charon", "de-DE-Chirp3-HD-Kore", "de-DE-Chirp3-HD-Puck", "de-DE-Chirp3-HD-Leda",
        "de-DE-Studio-B", "de-DE-Studio-C"],
    "ZH": ["cmn-CN-Chirp3-HD-Fenrir", "cmn-CN-Chirp3-HD-Aoede", "cmn-CN-Chirp3-HD-Charon", "cmn-CN-Chirp3-HD-Kore", "cmn-CN-Chirp3-HD-Puck", "cmn-CN-Chirp3-HD-Leda",
        "cmn-CN-Wavenet-C", "cmn-CN-Wavenet-A"]
};

// Curated Microsoft Azure Speech (Neural) voices per language. Azure uses its own
// language codes (zh-CN where Google uses cmn-CN); the code lives in the voice name.
const azureVoices: { [key: string]: string[] } = {
    "FR": ["fr-FR-DeniseNeural", "fr-FR-HenriNeural"],
    "EN": ["en-US-JennyNeural", "en-US-GuyNeural", "en-GB-SoniaNeural", "en-GB-RyanNeural"],
    "DE": ["de-DE-KatjaNeural", "de-DE-ConradNeural"],
    "ZH": ["zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural"]
};

const toOptions = (names: string[] | undefined, provider: VoiceProvider): VoiceOption[] =>
    (names ?? []).map(name => ({ id: `${provider}:${name}`, label: name, provider }));

// Single source of truth: every selectable voice for a language, both providers.
export const voiceCatalog: { [key: string]: VoiceOption[] } = Object.fromEntries(
    languages.map(lang => [lang, [...toOptions(googleVoices[lang], "google"), ...toOptions(azureVoices[lang], "azure")]])
);

const PROVIDER_LABELS: Record<VoiceProvider, string> = { google: "Google", azure: "Azure" };

/** antd grouped Select options (one optgroup per provider that has voices for the language). */
export const voiceSelectGroups = (lang: string): { label: string; options: { label: string; value: string }[] }[] => {
    const groups: { label: string; options: { label: string; value: string }[] }[] = [];
    for (const provider of ["google", "azure"] as VoiceProvider[]) {
        const options = (voiceCatalog[lang] ?? [])
            .filter(v => v.provider === provider)
            .map(v => ({ label: v.label, value: v.id }));
        if (options.length) groups.push({ label: PROVIDER_LABELS[provider], options });
    }
    return groups;
};

/** Default (provider-prefixed) narration voice for a new translation in `lang`. */
export const defaultVoiceId = (lang: string): string => voiceCatalog[lang]?.[0]?.id ?? "";

/**
 * Normalizes a stored voice id for display/matching: a bare (legacy, pre-multi-provider)
 * value is treated as Google-prefixed so it matches a catalog option.
 */
export const normalizeVoiceId = (voice?: string): string | undefined =>
    !voice ? voice : (voice.includes(":") ? voice : `google:${voice}`);

/**
 * The voice a side should narrate `lang` with, given whatever it carries now.
 *
 * A voice belongs to a language: its id names the locale the engine speaks, and the audio build
 * reads that locale off the voice and never off the side, so a voice left over from a language the
 * side no longer holds would have German lines read aloud in American English. Keep it only while
 * it is still one of `lang`'s voices; otherwise take that language's default, so changing a
 * language never leaves a side mute either.
 */
export const voiceForLang = (lang: string, current?: string): string => {
    const normalized = normalizeVoiceId(current);
    return normalized && voiceCatalog[lang]?.some(v => v.id === normalized)
        ? normalized
        : defaultVoiceId(lang);
};
