import React from 'react';
import { Select } from 'antd';
import { useVoiceInput } from '../../ui-foundation/voice-input/VoiceInputContext';
import { LanguageFlag } from '../../ui-foundation/language/LanguageFlag';

/** The languages one speaks to the app in — each shown as the flag of the locale it recognises. */
const LANGUAGES = ['en-US', 'fr-FR', 'de-DE', 'zh-CN'].map(value => ({
    value,
    label: <LanguageFlag lang={value} />,
}));

export const LanguageSwitch: React.FC = () => {
    const { language, setLanguage } = useVoiceInput();

    return (
        <Select
            value={language}
            onChange={setLanguage}
            options={LANGUAGES}
            variant="borderless"
            size="small"
            suffixIcon={null}
            popupMatchSelectWidth={false}
            style={{ width: 'auto' }}
        />
    );
}
