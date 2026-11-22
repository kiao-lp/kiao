import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ArchDiaFile, DiagramScene } from '../lib/archdia-model';
import { RelationBend } from '../lib/relation-geometry';
import { ArchDiaSvgRenderer, ContentBox, DisplayOptions } from './ArchDiaSvgRenderer';
import { ArchDiaToolbar, ArchDiaView } from './ArchDiaToolbar';
import { ArchDiaStyle } from './ArchDiaStyle';
import { ArchDiaCodeEditor } from './ArchDiaCodeEditor';
import { useZoom } from '@kiao-dashboard-kit/diagram-shared';

export interface ArchDiaViewState {
    view?: ArchDiaView;
    zoom?: number;
    displayOptions?: DisplayOptions;
}

export interface ArchDiaEditorProps {
    archDiaFile: ArchDiaFile | null;
    scene: DiagramScene | null;
    fileContent: string;
    onFileContentChange?: (content: string) => void;
    onPositionsChange?: (updates: Record<string, { x: number; y: number }>) => void;
    /** A null bend straightens the relation. */
    onBendsChange?: (updates: Record<string, RelationBend | null>) => void;
    onDescriptionsRawChange?: (raw: string | undefined) => void;
    source?: string;
    onPasteSource?: (source: string) => void;
    onPasteFileContent?: (content: string) => void;
    onRefreshLayout?: () => void;
    onPlantUmlLayout?: () => void;
    onTreemapLayout?: () => void;
    onExportSVG?: () => void;
    onFitToContent?: () => void;
    onNormalizePositions?: () => void;
    diagramSize?: { width: number; height: number };
    onDiagramSizeChange?: (size: { width: number; height: number }) => void;
    theme?: 'light' | 'dark';
    onSizeChange?: (box: ContentBox) => void;
    /** The host remembers this per file. */
    initialViewState?: ArchDiaViewState;
    onViewStateChange?: (patch: ArchDiaViewState) => void;
    className?: string;
    style?: React.CSSProperties;
}

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
