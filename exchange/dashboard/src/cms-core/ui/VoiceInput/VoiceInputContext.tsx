import React, { createContext, useContext, useMemo } from 'react';
import { useGlobalViewState } from '../../view-state';

export interface VoiceInputContextType {
    language: string;
    setLanguage: (lang: string) => void;
}

const VoiceInputContext = createContext<VoiceInputContextType | undefined>(undefined);

/** Match the browser's language when nothing has been chosen yet, else en-US. */
const browserDefaultLanguage = (): string => {
    const browserLang = navigator.language;
    if (browserLang.startsWith('fr')) return 'fr-FR';
    if (browserLang.startsWith('de')) return 'de-DE';
    if (browserLang.startsWith('zh')) return 'zh-CN';
    return 'en-US';
};

export const VoiceInputProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const fallback = useMemo(browserDefaultLanguage, []);
    const [language, setLanguage] = useGlobalViewState<string>('voiceLanguage', fallback);

    return (
        <VoiceInputContext.Provider value={{ language, setLanguage }}>
            {children}
        </VoiceInputContext.Provider>
    );
};

export const useVoiceInput = () => {
    const context = useContext(VoiceInputContext);
    if (!context) {
        throw new Error('useVoiceInput must be used within a VoiceInputProvider');
    }
    return context;
};
