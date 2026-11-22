import React, { useContext, useEffect, useState } from 'react';
import {
    parseArchDiaFile,
    getCombinedSource,
    plantumlExtractor,
    ArchDiaSvgRenderer,
    ArchDiaFile,
    DiagramScene,
    DisplayOptions,
    ArchDiaStyle,
    ARCHDIA_CSS_VARS,
} from '@kiao-dashboard-kit/archdia';
import { themeMode, DEFAULT_KIAO_THEME } from 'kiao-style';
import { ThemeContext, type Theme } from '../../ui-foundation/theme/ThemeContext';

const DISPLAY_OPTIONS: DisplayOptions = { showMethods: true, showProperties: true, showTypes: true };

export interface ArchDiaProps {
    children: string;
    theme?: Theme;
}

/** Drawing only; editing lives in the archdia editor (see `blockEditors`). */
export const ArchDia: React.FC<ArchDiaProps> = ({ children, theme }) => {
    const [state, setState] = useState<{ archDiaFile: ArchDiaFile, scene: DiagramScene } | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const text = children;
        const emptyScene = { components: [], containers: [], relations: [] };

        parseArchDiaFile(text, emptyScene)
            .then(preliminary => {
                const combinedSource = getCombinedSource(preliminary);
                const scene = {
                    components: plantumlExtractor.extractComponents(combinedSource),
                    containers: plantumlExtractor.extractContainers(combinedSource),
                    relations: plantumlExtractor.extractRelations(combinedSource),
                };
                return parseArchDiaFile(text, scene).then(file => ({ file, scene }));
            })
            .then(({ file, scene }) => {
                setState({ archDiaFile: file, scene });
                setError(null);
            })
            .catch(err => {
                setError(err.message || 'Failed to render ArchDia diagram');
            });
    }, [children]);

    const appTheme = useContext(ThemeContext)?.theme ?? DEFAULT_KIAO_THEME;
    const resolvedTheme = theme ?? appTheme;
    const mode = themeMode(resolvedTheme);

    if (error) {
        return <div className="archdia-error" style={{ color: 'red' }}>Error: {error}</div>;
    }

    if (!state) {
        return <div>Loading ArchDia...</div>;
    }

    const hostBridge = {
        [ARCHDIA_CSS_VARS.accentBg]: 'var(--accent-bg)',
        [ARCHDIA_CSS_VARS.text]: 'var(--text)',
        [ARCHDIA_CSS_VARS.border]: 'var(--border)',
        [ARCHDIA_CSS_VARS.muted]: 'var(--muted)',
        [ARCHDIA_CSS_VARS.link]: 'var(--link)',
    } as React.CSSProperties;

    return (
        <div className={`archdia-viewer-container ${mode === 'light' ? 'archdia-theme-light' : ''}`}>
            <ArchDiaStyle />
            <div className="archdia-viewer-artboard" style={hostBridge}>
                <ArchDiaSvgRenderer
                    layout={state.archDiaFile.layout}
                    scene={state.scene}
                    displayOptions={DISPLAY_OPTIONS}
                    theme={mode}
                />
            </div>
        </div>
    );
};
