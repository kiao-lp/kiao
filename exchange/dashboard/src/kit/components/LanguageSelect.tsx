import React from 'react';
import { Select } from 'antd';
import { KiaoFlag } from '@cms-core';
import { languages, LANGUAGE_NAMES } from '../i18n/languages';

/**
 * Picks one of the languages KIAO authors content in.
 *
 * Shared because several plugins choose a language and never import from one another: a
 * document's single language, or the source and the target of a bilingual set.
 * The list is `ui/i18n/languages`, the one place that says which languages KIAO authors in.
 */
export const LanguageSelect: React.FC<{
    lang: string | undefined;
    setLang: (lang: string) => void;
    /** Offered as an empty choice — for a side whose language has not been decided yet. */
    allowEmpty?: boolean;
    placeholder?: string;
    ariaLabel?: string;
    style?: React.CSSProperties;
}> = ({ lang, setLang, allowEmpty = false, placeholder = 'Language', ariaLabel, style }) => {
    const options = [
        ...(allowEmpty ? [{ value: '', label: <span className="text-gray-500">—</span> }] : []),
        ...languages.map(code => ({
            value: code,
            label: <span><KiaoFlag lang={code} /> {LANGUAGE_NAMES[code] ?? code}</span>,
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
