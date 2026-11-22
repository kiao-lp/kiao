import { useEffect, useRef, useState } from 'react';
import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition';
import { formatSpokenText } from './formatSpokenText';

export const useVoiceInputHook = (
    onChange?: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void,
    value?: any,
    language: string = 'en-US',
    /** A disabled or read-only box takes no dictation, so it offers no microphone either. */
    enabled: boolean = true,
) => {
    const {
        transcript,
        listening,
        resetTranscript,
        browserSupportsSpeechRecognition,
        isMicrophoneAvailable
    } = useSpeechRecognition();

    const showMic = enabled && browserSupportsSpeechRecognition && isMicrophoneAvailable;

    // Dictation delivers to the latest callback without making it a trigger: a caller's handler is
    // a new function every render, and re-firing it would write the same words again.
    const deliver = useRef(onChange);
    deliver.current = onChange;

    const [baseValue, setBaseValue] = useState<string>('');
    const [hasStartedListening, setHasStartedListening] = useState(false);

    const toggleListening = async () => {
        if (listening) {
            await SpeechRecognition.stopListening();
            setHasStartedListening(false);
        } else {
            setBaseValue(String(value || ''));
            setHasStartedListening(true);
            resetTranscript();
            try {
                await SpeechRecognition.startListening({ continuous: true, language });
            } catch {
                setHasStartedListening(false);
            }
        }
    };

    useEffect(() => {
        if (!listening || !hasStartedListening) return;
        const rawNewValue = baseValue + (baseValue && transcript ? ' ' : '') + transcript;
        // Apply spoken punctuation formatting for French and English
        let newValue = rawNewValue;
        if (language.startsWith('fr')) {
            newValue = formatSpokenText(rawNewValue, 'fr');
        } else if (language.startsWith('en')) {
            newValue = formatSpokenText(rawNewValue, 'en');
        }

        // What the box already says needs no second writing, and no second write behind it.
        if (newValue === String(value ?? '')) return;

        if (deliver.current) {
            const event = {
                target: { value: newValue },
                currentTarget: { value: newValue }
            } as React.ChangeEvent<HTMLInputElement>;

            deliver.current(event);
        }
    }, [transcript, listening, hasStartedListening, baseValue, language]);

    // Cleanup: stop listening on unmount
    useEffect(() => {
        return () => {
            SpeechRecognition.stopListening();
        };
    }, []);

    return {
        showMic,
        listening,
        toggleListening
    };
};
