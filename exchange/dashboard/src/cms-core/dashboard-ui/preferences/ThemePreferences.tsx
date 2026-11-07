import React from 'react';
import { DEFAULT_KIAO_THEME } from 'kiao-style';
import { ThemeProvider, type Theme } from '../../ui-foundation/theme/ThemeContext';
import { useGlobalViewState } from '../../view-state/index';

export const ThemePreferences: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [theme, setTheme] = useGlobalViewState<Theme>('theme', DEFAULT_KIAO_THEME);
    return <ThemeProvider theme={theme} onThemeChange={setTheme}>{children}</ThemeProvider>;
};
