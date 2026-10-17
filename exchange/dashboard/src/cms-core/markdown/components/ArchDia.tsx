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
} from '@cms-kit/archdia';
import { themeMode, DEFAULT_KIAO_THEME } from 'kiao-style';
import { ThemeContext, type Theme } from '../../../ThemeContext';

/** A document shows the whole model: there is no toolbar here to hide parts of it. */
const DISPLAY_OPTIONS: DisplayOptions = { showMethods: true, showProperties: true, showTypes: true };

export interface ArchDiaProps {
    children: string;
    theme?: Theme;
}

/**
 * An archdia diagram drawn into a document.
 *
 * The drawing and nothing else — no artboard, no toolbar, no zoom. A diagram in
 * a page meant to be read, printed or exported is a picture like every other
 * diagram the renderer draws; the artboard and its instruments belong to the
 * archdia editor, which is where the block is changed (see `blockEditors`).
 */
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
    // The renderer and its stylesheet carry a light and a dark palette, and no more:
    // a sober theme is drawn at its own brightness.
    const mode = themeMode(resolvedTheme);

    if (error) {
        return <div className="archdia-error" style={{ color: 'red' }}>Error: {error}</div>;
    }

    if (!state) {
        return <div>Loading ArchDia...</div>;
    }

    // Bridge host app CSS vars to archdia CSS vars
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
