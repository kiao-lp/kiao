import { useEffect, useState } from 'react';
import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition';
import { formatSpokenText } from './formatSpokenText';

export const useVoiceInputHook = (
    onChange?: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void,
    value?: any,
    language: string = 'en-US'
) => {
    const {
        transcript,
        listening,
        resetTranscript,
        browserSupportsSpeechRecognition,
        isMicrophoneAvailable
    } = useSpeechRecognition();

    const showMic = browserSupportsSpeechRecognition && isMicrophoneAvailable;

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
        if (listening && hasStartedListening) {
            const rawNewValue = baseValue + (baseValue && transcript ? ' ' : '') + transcript;
            // Apply spoken punctuation formatting for French and English
            let newValue = rawNewValue;
            if (language.startsWith('fr')) {
                newValue = formatSpokenText(rawNewValue, 'fr');
            } else if (language.startsWith('en')) {
                newValue = formatSpokenText(rawNewValue, 'en');
            }

            if (onChange) {
                const event = {
                    target: { value: newValue },
                    currentTarget: { value: newValue }
                } as React.ChangeEvent<HTMLInputElement>;

                onChange(event);
            }
        }
    }, [transcript, listening, hasStartedListening, baseValue, onChange, language]);

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
