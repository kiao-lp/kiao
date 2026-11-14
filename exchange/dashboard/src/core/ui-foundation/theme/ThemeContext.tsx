import React, { createContext, useContext, useEffect, useState } from 'react';
import { asKiaoTheme, DEFAULT_KIAO_THEME, type KiaoTheme } from 'kiao-style';

export type Theme = KiaoTheme;

interface ThemeContextType {
    theme: Theme;
    setTheme: (next: Theme) => void;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export interface ThemeProviderProps {
    children: React.ReactNode;
    theme?: Theme;
    onThemeChange?: (theme: Theme) => void;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children, theme: controlledTheme, onThemeChange }) => {
    const [localTheme, setLocalTheme] = useState<Theme>(DEFAULT_KIAO_THEME);
    const theme = asKiaoTheme(controlledTheme ?? localTheme);
    const setTheme = (next: Theme) => {
        if (controlledTheme === undefined) setLocalTheme(next);
        onThemeChange?.(next);
    };

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

    return (
        <ThemeContext.Provider value={{ theme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};
