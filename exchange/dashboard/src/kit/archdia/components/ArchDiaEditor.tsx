import React, { useState, useEffect } from 'react';
import { ArchDiaFile, DiagramScene } from '../lib/archdia-model';
import { RelationBend } from '../lib/relation-geometry';
import { ArchDiaSvgRenderer, ContentBox, DisplayOptions } from './ArchDiaSvgRenderer';
import { IconMethods, IconProperties, IconTypes, IconTreemap, IconPlantUml } from './toolbar-icons';
import { ArchDiaStyle } from './ArchDiaStyle';
import { ArchDiaCodeEditor } from './ArchDiaCodeEditor';
import { DiagramToolbar, type DiagramView, IconRefresh, useZoom, ZoomSurface } from '@kiao-dashboard-core';

const displayToggles = [
    { key: 'showMethods', label: 'methods', icon: <IconMethods /> },
    { key: 'showProperties', label: 'properties', icon: <IconProperties /> },
    { key: 'showTypes', label: 'types', icon: <IconTypes /> },
] as const;

export interface ArchDiaViewState {
    view?: DiagramView;
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
    const [view, setViewInternal] = useState<DiagramView>(initialViewState?.view ?? 'diagram');
    const setView = (next: DiagramView) => { setViewInternal(next); onViewStateChange?.({ view: next }); };
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
    const { zoom, setZoom } = useZoom({
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
            <DiagramToolbar
                view={{ active: view, fileLabel: 'Edit File (Raw)', onChange: setView }}
                source={source}
                onPasteSource={onPasteSource}
                fileContent={fileContent}
                onPasteFileContent={onPasteFileContent}
                layoutActions={[
                    { text: 'Refresh layout', icon: <IconRefresh />, onClick: onRefreshLayout },
                    { text: 'PlantUML layout', icon: <IconPlantUml />, tooltip: true, onClick: onPlantUmlLayout },
                    { text: 'Treemap layout', icon: <IconTreemap />, tooltip: true, onClick: onTreemapLayout },
                ]}
                displayActions={displayToggles.map(({ key, label, icon }) => ({
                    text: `Show ${label}`,
                    tooltip: displayOptions[key] ? `Hide ${label}` : true,
                    icon,
                    active: displayOptions[key],
                    onClick: () => setDisplayOptions({ ...displayOptions, [key]: !displayOptions[key] }),
                }))}
                onFitToContent={onFitToContent}
                onNormalizePositions={onNormalizePositions}
                onExportSVG={onExportSVG}
                zoom={zoom}
                onZoomChange={setZoom}
                diagramSize={diagramSize}
                onDiagramSizeChange={onDiagramSizeChange}
                theme={currentTheme}
                onThemeChange={setCurrentTheme}
            />
            {view === 'diagram' && (
                <ZoomSurface className="archdia-canvas" zoom={zoom} onZoomChange={setZoom}>
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
                </ZoomSurface>
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
