import { describe, it, expect } from 'vitest';
import { voiceForLang } from './voices';

/**
 * A voice belongs to a language, and nothing downstream re-checks that: the audio build reads the
 * locale it synthesizes in off the voice id itself. So the one rule that matters is that a side
 * given another language never keeps the voice of the one it left.
 */
describe('voiceForLang', () => {

    it('gives a side with no voice the default for its language', () => {
        expect(voiceForLang('DE')).toBe('google:de-DE-Chirp3-HD-Fenrir');
        expect(voiceForLang('FR', '')).toBe('google:fr-FR-Chirp3-HD-Puck');
    });

    it('keeps a voice that is one of the language’s own', () => {
        expect(voiceForLang('FR', 'azure:fr-FR-HenriNeural')).toBe('azure:fr-FR-HenriNeural');
        expect(voiceForLang('EN', 'google:en-GB-News-K')).toBe('google:en-GB-News-K');
    });

    // The case the settings dialog used to leave standing: German lines under an American voice.
    it('replaces a voice left over from another language', () => {
        expect(voiceForLang('DE', 'google:en-US-Chirp3-HD-Fenrir')).toBe('google:de-DE-Chirp3-HD-Fenrir');
        expect(voiceForLang('EN', 'azure:fr-FR-DeniseNeural')).toBe('google:en-US-Chirp3-HD-Fenrir');
    });

    // A bare id predates the multi-provider ids and means Google; it is the same voice.
    it('keeps a legacy unprefixed id of the right language, prefixed', () => {
        expect(voiceForLang('FR', 'fr-FR-Studio-D')).toBe('google:fr-FR-Studio-D');
    });

    it('falls back to the default for a voice no catalog holds', () => {
        expect(voiceForLang('ZH', 'google:made-up-voice')).toBe('google:cmn-CN-Chirp3-HD-Fenrir');
    });
});
