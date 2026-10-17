import React, { createContext, useContext, useEffect } from 'react';
import { asKiaoTheme, DEFAULT_KIAO_THEME, type KiaoTheme } from 'kiao-style';
import { useGlobalViewState } from './cms-core/view-state';

export type Theme = KiaoTheme;

interface ThemeContextType {
    theme: Theme;
    setTheme: (next: Theme) => void;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [stored, setTheme] = useGlobalViewState<Theme>('theme', DEFAULT_KIAO_THEME);

    // A preference written before a theme was renamed, or set by hand, can name one the
    // charter does not ship. There is no styling behind that name, so it reads as the default
    // rather than leaving the application unstyled.
    const theme = asKiaoTheme(stored);

    // index.html already carries the default; this applies the stored choice.
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
