import React, { createContext, useContext, useState } from 'react';

export interface VoiceInputContextType {
    language: string;
    setLanguage: (lang: string) => void;
}

const VoiceInputContext = createContext<VoiceInputContextType | undefined>(undefined);

/** Match the browser's language when nothing has been chosen yet, else en-US. */
export const browserDefaultLanguage = (): string => {
    const browserLang = navigator.language;
    if (browserLang.startsWith('fr')) return 'fr-FR';
    if (browserLang.startsWith('de')) return 'de-DE';
    if (browserLang.startsWith('zh')) return 'zh-CN';
    return 'en-US';
};

export interface VoiceInputProviderProps {
    children: React.ReactNode;
    language?: string;
    onLanguageChange?: (language: string) => void;
}

export const VoiceInputProvider: React.FC<VoiceInputProviderProps> = ({ children, language: controlledLanguage, onLanguageChange }) => {
    const [localLanguage, setLocalLanguage] = useState(browserDefaultLanguage);
    const language = controlledLanguage ?? localLanguage;
    const setLanguage = (next: string) => {
        if (controlledLanguage === undefined) setLocalLanguage(next);
        onLanguageChange?.(next);
    };

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
