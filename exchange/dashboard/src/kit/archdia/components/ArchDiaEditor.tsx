import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ArchDiaFile, DiagramScene } from '../lib/archdia-model';
import { RelationBend } from '../lib/relation-geometry';
import { ArchDiaSvgRenderer, ContentBox, DisplayOptions } from './ArchDiaSvgRenderer';
import { ArchDiaToolbar, ArchDiaView } from './ArchDiaToolbar';
import { ArchDiaStyle } from './ArchDiaStyle';
import { ArchDiaCodeEditor } from './ArchDiaCodeEditor';
import { useZoom } from '@cms-kit/diagram-shared';

// ── Props ─────────────────────────────────────────────────────────

/** How the editor was left: the view, its display toggles, and the zoom. */
export interface ArchDiaViewState {
    view?: ArchDiaView;
    zoom?: number;
    displayOptions?: DisplayOptions;
}

export interface ArchDiaEditorProps {
    /** The parsed ArchDiaFile (sources + layout). Null while loading. */
    archDiaFile: ArchDiaFile | null;
    /** The computed diagram scene. */
    scene: DiagramScene | null;
    /** Serialized file content for the raw editor and copy/paste. */
    fileContent: string;
    /** Called when the raw file content changes (from the code editor). */
    onFileContentChange?: (content: string) => void;
    /** Called when diagram positions change via drag. */
    onPositionsChange?: (updates: Record<string, { x: number; y: number }>) => void;
    /** Called when a relation's centre is dragged; a null value straightens it again. */
    onBendsChange?: (updates: Record<string, RelationBend | null>) => void;
    /** Called when description markdown changes. */
    onDescriptionsRawChange?: (raw: string | undefined) => void;
    /** Combined PlantUML source (for copy-to-clipboard). */
    source?: string;
    /** Called when user pastes source from clipboard. */
    onPasteSource?: (source: string) => void;
    /** Called when user pastes full file content from clipboard. */
    onPasteFileContent?: (content: string) => void;
    /** Called to refresh/reset the layout. */
    onRefreshLayout?: () => void;
    /** Called to apply the PlantUML layout. */
    onPlantUmlLayout?: () => void;
    /** Called to apply treemap layout. */
    onTreemapLayout?: () => void;
    /** Called to export/download SVG. */
    onExportSVG?: () => void;
    /** Called to fit the diagram size to its content. */
    onFitToContent?: () => void;
    /** Called to shift all elements so no x/y is negative. */
    onNormalizePositions?: () => void;
    /** Current diagram size. */
    diagramSize?: { width: number; height: number };
    /** Called when the user picks a new diagram size from the presets. */
    onDiagramSizeChange?: (size: { width: number; height: number }) => void;
    /** Theme for the diagram renderer ('light' | 'dark'). */
    theme?: 'light' | 'dark';
    /** Called when the renderer reports the box its content is drawn in. */
    onSizeChange?: (box: ContentBox) => void;
    /** Seeds the view, toggles and zoom on mount; the host remembers them per file. */
    initialViewState?: ArchDiaViewState;
    /** Called whenever the view, a display toggle, or the zoom changes. */
    onViewStateChange?: (patch: ArchDiaViewState) => void;
    /** Optional CSS class for the outer wrapper. */
    className?: string;
    /** Optional inline style for the outer wrapper. */
    style?: React.CSSProperties;
}

// ── Component ─────────────────────────────────────────────────────

export const ArchDiaEditor: React.FC<ArchDiaEditorProps> = ({
    archDiaFile,
    scene,
    fileContent,
    onFileContentChange,
    onPositionsChange,
    onBendsChange,
    onDescriptionsRawChange,
    source,
    onPasteSource,
    onPasteFileContent,
    onRefreshLayout,
    onPlantUmlLayout,
    onTreemapLayout,
    onExportSVG,
    onFitToContent,
    onNormalizePositions,
    diagramSize,
    onDiagramSizeChange,
    theme,
    onSizeChange,
    initialViewState,
    onViewStateChange,
    className,
    style,
}) => {
    const [view, setViewInternal] = useState<ArchDiaView>(initialViewState?.view ?? 'diagram');
    const setView = (next: ArchDiaView) => { setViewInternal(next); onViewStateChange?.({ view: next }); };
    const [displayOptions, setDisplayOptionsInternal] = useState<DisplayOptions>({
        showMethods: true,
        showProperties: true,
        showTypes: true,
        ...initialViewState?.displayOptions,
    });
    const setDisplayOptions = (next: DisplayOptions) => {
        setDisplayOptionsInternal(next);
        onViewStateChange?.({ displayOptions: next });
    };
    const { zoom, setZoom, canvasRef } = useZoom({
        initial: initialViewState?.zoom,
        onChange: z => onViewStateChange?.({ zoom: z }),
    });
    const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>(theme ?? 'dark');

    useEffect(() => {
        if (theme !== undefined) setCurrentTheme(theme);
    }, [theme]);

    if (!archDiaFile || !scene) return null;

    return (
        <div
            className={`archdia-editor-container${currentTheme === 'light' ? ' archdia-theme-light' : ''}${className ? ` ${className}` : ''}`}
            style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden', ...style }}
        >
            <ArchDiaStyle />
            <ArchDiaToolbar
                activeView={view}
                onViewChange={setView}
                source={source}
                onPasteSource={onPasteSource}
                fileContent={fileContent}
                onPasteFileContent={onPasteFileContent}
                onRefreshLayout={onRefreshLayout}
                onPlantUmlLayout={onPlantUmlLayout}
                onTreemapLayout={onTreemapLayout}
                onFitToContent={onFitToContent}
                onNormalizePositions={onNormalizePositions}
                onExportSVG={onExportSVG}
                displayOptions={displayOptions}
                onDisplayOptionsChange={setDisplayOptions}
                zoom={zoom}
                onZoomChange={setZoom}
                diagramSize={diagramSize}
                onDiagramSizeChange={onDiagramSizeChange}
                theme={currentTheme}
                onThemeChange={setCurrentTheme}
            />
            {view === 'diagram' && (
                <div className="archdia-canvas" ref={canvasRef}>
                    <div className="archdia-zoom-container" style={zoom !== 1.0 ? { transform: `scale(${zoom})`, transformOrigin: 'top left' } : undefined}>
                        <ArchDiaSvgRenderer
                            layout={archDiaFile.layout}
                            descriptionsRaw={archDiaFile.descriptionsRaw}
                            scene={scene}
                            onPositionsChange={onPositionsChange}
                            onBendsChange={onBendsChange}
                            onDescriptionsRawChange={onDescriptionsRawChange}
                            displayOptions={displayOptions}
                            theme={currentTheme}
                            onSizeChange={onSizeChange}
                        />
                    </div>
                </div>
            )}
            {view === 'file' && (
                <ArchDiaCodeEditor
                    value={fileContent}
                    onChange={onFileContentChange}
                />
            )}
        </div>
    );
};
