import { useEffect, useRef, useState } from 'react';
import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition';
import { useVoiceInput } from './VoiceInputContext';
import { formatSpokenText } from './formatSpokenText';

interface Dictation {
    base: string;
    language: string;
    starting: boolean;
    cancelled?: boolean;
}

// The browser recognizer is global, but only the field that started it receives the transcript.
let activeDictation: Dictation | undefined;

function stopDictation(dictation: Dictation) {
    dictation.cancelled = true;
    if (dictation.starting) return;
    activeDictation = undefined;
    void SpeechRecognition.stopListening();
}

export function useVoiceInputHook(
    value: string | undefined,
    onChange: (next: string) => void,
    enabled: boolean,
) {
    const { language } = useVoiceInput();
    const { transcript, listening, resetTranscript, browserSupportsSpeechRecognition, isMicrophoneAvailable } =
        useSpeechRecognition();
    const showMic = enabled && browserSupportsSpeechRecognition && isMicrophoneAvailable;
    const request = useRef<Dictation>();
    const [dictation, setDictation] = useState<Dictation>();
    const field = useRef({ value, onChange });
    field.current = { value, onChange };

    const toggleListening = async () => {
        if (activeDictation) {
            if (request.current === activeDictation) stopDictation(activeDictation);
            return;
        }

        const next: Dictation = { base: value ?? '', language, starting: true };
        request.current = activeDictation = next;
        resetTranscript();
        try {
            await SpeechRecognition.startListening({ continuous: true, language });
        } catch {
            activeDictation = undefined;
            return;
        }
        next.starting = false;
        if (next.cancelled) stopDictation(next);
        else setDictation(next);
    };

    useEffect(() => {
        if (!dictation || dictation !== activeDictation) return;
        if (!listening) {
            activeDictation = undefined;
            return;
        }
        if (!showMic || !transcript) return;

        const raw = dictation.base ? `${dictation.base} ${transcript}` : transcript;
        const locale = dictation.language.slice(0, 2);
        const next = locale === 'fr' || locale === 'en' ? formatSpokenText(raw, locale) : raw;
        if (next !== field.current.value) field.current.onChange(next);
    }, [dictation, listening, showMic, transcript]);

    useEffect(() => {
        if (!showMic) return;
        return () => {
            if (activeDictation && activeDictation === request.current) stopDictation(activeDictation);
        };
    }, [showMic]);

    const ownsDictation = activeDictation !== undefined && activeDictation === request.current;
    return { showMic, listening: listening && ownsDictation, busy: listening && !ownsDictation, toggleListening };
}
