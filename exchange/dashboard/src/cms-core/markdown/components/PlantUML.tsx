import React, { useContext, useEffect, useMemo } from 'react';
import plantumlEncoder from 'plantuml-encoder';
import { kiaoPlantUMLTheme, injectPlantUMLTheme, DEFAULT_KIAO_THEME } from 'kiao-style';
import { ThemeContext, type Theme } from '../../../ThemeContext';

const DEFAULT_PLANTUML_SERVER = 'https://www.plantuml.com/plantuml';

export interface PlantUMLProps {
    children: string;
    serverUrl?: string;
    theme?: Theme;
    className?: string;
    style?: React.CSSProperties;
    onUrl?: (url: string) => void;
}

export const PlantUML: React.FC<PlantUMLProps> = ({
    children,
    serverUrl,
    theme,
    className,
    style,
    onUrl,
}) => {
    const appTheme = useContext(ThemeContext)?.theme ?? DEFAULT_KIAO_THEME;
    const resolvedTheme = theme ?? appTheme;

    const imageUrl = useMemo(() => {
        try {
            const themed = injectPlantUMLTheme(children.trim(), kiaoPlantUMLTheme(resolvedTheme));
            const encoded = plantumlEncoder.encode(themed);
            const baseUrl = (serverUrl || import.meta.env.VITE_PLANTUML_SERVER_URL || DEFAULT_PLANTUML_SERVER).replace(/\/$/, '');
            return `${baseUrl}/svg/${encoded}`;
        } catch (e) {
            console.error('Failed to encode PlantUML', e);
            return '';
        }
    }, [children, serverUrl, resolvedTheme]);

    useEffect(() => {
        if (imageUrl) onUrl?.(imageUrl);
    }, [imageUrl]);

    if (!imageUrl) {
        return <pre className={className}>{children}</pre>;
    }

    return (
        <img
            src={imageUrl}
            alt="PlantUML Diagram"
            className={className}
            data-plantuml-source={children.trim()}
            style={{ maxWidth: '100%', ...style }}
        />
    );
};
