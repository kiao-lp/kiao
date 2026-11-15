import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KIAO_THEME } from 'kiao-style';
import { ThemeProvider, useTheme } from './ThemeContext';
import { VoiceInputProvider, useVoiceInput } from '../voice-input/VoiceInputContext';

const Preferences = () => {
    const { theme, setTheme } = useTheme();
    const { language, setLanguage } = useVoiceInput();
    return <>
        <button aria-label="Theme" onClick={() => setTheme('light')}>{theme}</button>
        <button aria-label="Language" onClick={() => setLanguage('fr-FR')}>{language}</button>
    </>;
};

describe('standalone UI providers', () => {
    it('keeps preferences locally without an application store', () => {
        render(<ThemeProvider><VoiceInputProvider><Preferences /></VoiceInputProvider></ThemeProvider>);
        expect(screen.getByRole('button', { name: 'Theme' })).toHaveTextContent(DEFAULT_KIAO_THEME);
        fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
        fireEvent.click(screen.getByRole('button', { name: 'Language' }));
        expect(screen.getByRole('button', { name: 'Theme' })).toHaveTextContent('light');
        expect(screen.getByRole('button', { name: 'Language' })).toHaveTextContent('fr-FR');
    });

    it('leaves controlled preferences to the caller and follows updated props', () => {
        const onThemeChange = vi.fn();
        const onLanguageChange = vi.fn();
        const providers = (theme: 'dark' | 'light', language: string) => (
            <ThemeProvider theme={theme} onThemeChange={onThemeChange}>
                <VoiceInputProvider language={language} onLanguageChange={onLanguageChange}>
                    <Preferences />
                </VoiceInputProvider>
            </ThemeProvider>
        );
        const { rerender } = render(providers('dark', 'en-US'));
        fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
        fireEvent.click(screen.getByRole('button', { name: 'Language' }));
        expect(onThemeChange).toHaveBeenCalledWith('light');
        expect(onLanguageChange).toHaveBeenCalledWith('fr-FR');
        expect(screen.getByRole('button', { name: 'Theme' })).toHaveTextContent('dark');
        expect(screen.getByRole('button', { name: 'Language' })).toHaveTextContent('en-US');
        rerender(providers('light', 'fr-FR'));
        expect(screen.getByRole('button', { name: 'Theme' })).toHaveTextContent('light');
        expect(screen.getByRole('button', { name: 'Language' })).toHaveTextContent('fr-FR');
    });
});
