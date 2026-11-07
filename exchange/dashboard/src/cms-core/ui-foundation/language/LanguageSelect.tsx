import React from 'react';
import { Select } from 'antd';
import { LanguageFlag } from './LanguageFlag';
import { languages, LANGUAGE_NAMES } from './languages';

/** Picks a language from the supplied codes or the default language list. */
export const LanguageSelect: React.FC<{
    lang: string | undefined;
    setLang: (lang: string) => void;
    /** Empty choice for an undecided language. */
    allowEmpty?: boolean;
    placeholder?: string;
    ariaLabel?: string;
    style?: React.CSSProperties;
    languages?: readonly string[];
    languageNames?: Readonly<Record<string, string>>;
}> = ({ lang, setLang, allowEmpty = false, placeholder = 'Language', ariaLabel, style,
    languages: availableLanguages = languages, languageNames = LANGUAGE_NAMES }) => {
    const options = [
        ...(allowEmpty ? [{ value: '', label: <span className="text-gray-500">—</span> }] : []),
        ...availableLanguages.map(code => ({
            value: code,
            label: <span><LanguageFlag lang={code} /> {languageNames[code] ?? code}</span>,
        })),
    ];

    return (
        <Select
            options={options}
            value={lang || undefined}
            onChange={setLang}
            placeholder={placeholder}
            aria-label={ariaLabel}
            style={{ minWidth: 150, ...style }}
        />
    );
};
