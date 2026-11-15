import React, { useMemo } from 'react';
import { browserDefaultLanguage, VoiceInputProvider } from '../../ui-foundation/voice-input/VoiceInputContext';
import { useGlobalViewState } from '../../view-state/index';

export const VoiceInputPreferences: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const fallback = useMemo(browserDefaultLanguage, []);
    const [language, setLanguage] = useGlobalViewState<string>('voiceLanguage', fallback);
    return <VoiceInputProvider language={language} onLanguageChange={setLanguage}>{children}</VoiceInputProvider>;
};
