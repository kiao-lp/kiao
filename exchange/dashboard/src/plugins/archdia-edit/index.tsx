import React, { useCallback, useRef } from 'react';

import { themeMode } from 'kiao-style';
import {
    FileDto,
    CmsPlugin,
    extractFileNameFn,
    FileLabelCmp,
    MainViewCmp,
    LayoutContent,
    TopBanner,
    useFileBrowsingPersistenceContext,
    useFileViewState,
    useTheme
} from '@cms-core';

import './styles.css';
import iconImg from './archdia.svg';

import type { ArchDiaViewState, ContentBox } from '@cms-kit/archdia';
import { ArchDiaEditor, serializeSvgForExport, downloadFile, ARCHDIA_CSS_VARS, serializeArchDiaFile, getCombinedSource, fitToContent, normalizePositions } from '@cms-kit/archdia';
import { useArchDiaState } from './hooks/useArchDiaState';

import { ArchDiaCreationPlugin } from './ArchDiaCreationPlugin';

// === Configuration ===

const extension = ".arch.md";

// === Main View ===

const MainView: MainViewCmp = () => {
    const { currentFile } = useFileBrowsingPersistenceContext();

    React.useEffect(() => {
        if (currentFile) document.title = extractFileNameFn(extension)(currentFile);
    }, [currentFile]);

    const { archDiaFile, scene, loading, error, updateSource, updateLayout, updatePositions, updateBends, updateDescriptionsRaw, resetLayout, applyPlantUmlLayout, applyTreemapLayout, updateRawContent } = useArchDiaState(currentFile?.path);

    const { theme } = useTheme();

    // The view, its toggles and the zoom belong to the diagram being read, not
    // to the app: a dense diagram is left zoomed out, a small one is not.
    const [viewState, setViewState] = useFileViewState<ArchDiaViewState>('archdia', {});

    // Track the box the renderer draws its content in: where it sits as much as how big it is,
    // since cropping to it moves the diagram into the new size.
    const contentBoxRef = useRef<ContentBox | null>(null);

    const handleSizeChange = useCallback((box: ContentBox) => {
        contentBoxRef.current = box;
    }, []);

    const handleFitToContent = useCallback(() => {
        if (!contentBoxRef.current || !archDiaFile || !updateLayout) return;
        const newFile = fitToContent(archDiaFile, contentBoxRef.current);
        updateLayout(newFile.layout);
    }, [archDiaFile, updateLayout]);

    const handleNormalizePositions = useCallback(() => {
        if (!archDiaFile || !scene || !updateLayout) return;
        const newFile = normalizePositions(archDiaFile, scene);
        if (newFile !== archDiaFile) {
            updateLayout(newFile.layout);
        }
    }, [archDiaFile, scene, updateLayout]);

    const handleExportSVG = useCallback(() => {
        const svgElement = document.querySelector('.archdia-svg');
        if (!svgElement) return;
        const svg = serializeSvgForExport(svgElement);
        const fileName = (currentFile ? extractFileNameFn(extension)(currentFile) : 'diagram') + '.svg';
        downloadFile(svg, fileName);
    }, [currentFile]);

    const handlePasteSource = useCallback((newSource: string) => {
        if (updateSource) updateSource(newSource);
    }, [updateSource]);

    // Bridge host app CSS vars to archdia CSS vars
    const hostBridge = archDiaFile ? {
        [ARCHDIA_CSS_VARS.accentBg]: 'var(--accent-bg)',
        [ARCHDIA_CSS_VARS.text]: 'var(--text)',
        [ARCHDIA_CSS_VARS.border]: 'var(--border)',
        [ARCHDIA_CSS_VARS.muted]: 'var(--muted)',
        [ARCHDIA_CSS_VARS.link]: 'var(--link)',
    } as React.CSSProperties : undefined;

    return (
        <>
            <LayoutContent>
                {loading && <div className="archdia-loading">Loading diagram…</div>}
                {error && <div className="archdia-error">Error: {error}</div>}
                {archDiaFile && (
                    <ArchDiaEditor
                        archDiaFile={archDiaFile}
                        scene={scene}
                        fileContent={serializeArchDiaFile(archDiaFile)}
                        onFileContentChange={updateRawContent}
                        onPositionsChange={updatePositions}
                        onBendsChange={updateBends}
                        onDescriptionsRawChange={updateDescriptionsRaw}
                        source={getCombinedSource(archDiaFile)}
                        onPasteSource={handlePasteSource}
                        onPasteFileContent={updateRawContent}
                        onRefreshLayout={resetLayout}
                        onPlantUmlLayout={applyPlantUmlLayout}
                        onTreemapLayout={applyTreemapLayout}
                        onExportSVG={handleExportSVG}
                        onFitToContent={handleFitToContent}
                        onNormalizePositions={handleNormalizePositions}
                        diagramSize={archDiaFile.layout.size}
                        onDiagramSizeChange={(size) => updateLayout({ ...archDiaFile.layout, size })}
                        theme={themeMode(theme)}
                        initialViewState={viewState}
                        onViewStateChange={setViewState}
                        onSizeChange={handleSizeChange}
                        style={hostBridge}
                    />
                )}
            </LayoutContent>
            <TopBanner />
        </>
    );
};

// === File Label ===

const fileLabelCmp: FileLabelCmp = ({ file }) => (
    <><img src={iconImg} className="file-label-icon" alt={extractFileNameFn(extension)(file)} />{extractFileNameFn(extension)(file)}</>
);

// === Export ===

const fileConfigFor = (file: FileDto) => file.path.endsWith(extension) ? {
    fileLabelCmp,
    mainView: MainView,
} : null;

export const plugin: CmsPlugin = {
    id: 'archdia-edit',
    fileConfigFor,
    fileExtensions: [extension],
    CreationProvider: ArchDiaCreationPlugin,
};
