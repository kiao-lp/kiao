/**
 * Toolbar for the graph diagram editor.
 *
 * Reuses shared toolbar primitives (icons, ToolbarButton)
 * and provides graph-specific actions.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Tooltip } from '@cms-core';
import {
    ToolbarButton,
    IconCopyFile,
    IconPasteFile,
    IconCheck,
    IconDownload,
    IconFitToContent,
    IconNormalize,
    IconPlay,
    IconZoomIn,
    IconZoomOut,
    IconPicture,
    IconFile,
    IconSun,
    IconMoon,
    DIAGRAM_SIZE_PRESETS,
} from '@cms-kit/diagram-shared';

const P = 'graph';

// ─── Props ──────────────────────────────────────────────────────────

export type GraphView = 'diagram' | 'file';

export interface GraphToolbarProps {
    activeView?: GraphView;
    onViewChange?: (view: GraphView) => void;
    fileContent?: string;
    onPasteFileContent?: (content: string) => void;
    onFitToContent?: () => void;
    onNormalizePositions?: () => void;
    onExportSVG?: () => void;
    zoom: number;
    onZoomChange: (zoom: number) => void;
    diagramSize?: { width: number; height: number };
    onDiagramSizeChange?: (size: { width: number; height: number }) => void;
    theme?: 'light' | 'dark';
    onThemeChange?: (theme: 'light' | 'dark') => void;
    algorithms?: string[];
    onRunAlgorithms?: () => void;
}

// ─── Component ──────────────────────────────────────────────────────

export const GraphToolbar: React.FC<GraphToolbarProps> = ({
    activeView,
    onViewChange,
    fileContent,
    onPasteFileContent,
    onFitToContent,
    onNormalizePositions,
    onExportSVG,
    zoom,
    onZoomChange,
    diagramSize,
    onDiagramSizeChange,
    theme,
    onThemeChange,
    algorithms,
    onRunAlgorithms,
}) => {
    const hasViewToggle = activeView !== undefined && onViewChange !== undefined;
    const isDiagramView = !hasViewToggle || activeView === 'diagram';
    const [copiedFile, setCopiedFile] = useState(false);
    const [pastedFile, setPastedFile] = useState(false);
    const [sizeDropdownOpen, setSizeDropdownOpen] = useState(false);
    const sizeDropdownRef = useRef<HTMLDivElement>(null);

    const [customWidth, setCustomWidth] = useState<string>(diagramSize?.width?.toString() ?? '925');
    const [customHeight, setCustomHeight] = useState<string>(diagramSize?.height?.toString() ?? '768');

    useEffect(() => {
        if (!sizeDropdownOpen && diagramSize) {
            setCustomWidth(diagramSize.width.toString());
            setCustomHeight(diagramSize.height.toString());
        }
    }, [diagramSize, sizeDropdownOpen]);

    useEffect(() => {
        if (!sizeDropdownOpen) return;
        const handleClick = (e: MouseEvent) => {
            if (sizeDropdownRef.current && !sizeDropdownRef.current.contains(e.target as Node)) {
                setSizeDropdownOpen(false);
            }
        };
        window.addEventListener('mousedown', handleClick);
        return () => window.removeEventListener('mousedown', handleClick);
    }, [sizeDropdownOpen]);

    const currentSizeLabel = diagramSize
        ? DIAGRAM_SIZE_PRESETS.find(p => p.width === diagramSize.width && p.height === diagramSize.height)?.label
            ?? `${diagramSize.width}\u00d7${diagramSize.height}`
        : undefined;

    const handleCopyFile = useCallback(async () => {
        if (!fileContent) return;
        try {
            await navigator.clipboard.writeText(fileContent);
            setCopiedFile(true);
            setTimeout(() => setCopiedFile(false), 1500);
        } catch { /* clipboard not available */ }
    }, [fileContent]);

    const handlePasteFile = useCallback(async () => {
        if (!onPasteFileContent) return;
        try {
            const text = await navigator.clipboard.readText();
            onPasteFileContent(text);
            setPastedFile(true);
            setTimeout(() => setPastedFile(false), 1500);
        } catch { /* clipboard not available */ }
    }, [onPasteFileContent]);

    const zoomIn = useCallback(() => onZoomChange(Math.min(2.0, zoom + 0.1)), [zoom, onZoomChange]);
    const zoomOut = useCallback(() => onZoomChange(Math.max(0.25, zoom - 0.1)), [zoom, onZoomChange]);
    const zoomReset = useCallback(() => onZoomChange(1.0), [onZoomChange]);

    const handleApplyCustomSize = useCallback(() => {
        const w = parseInt(customWidth, 10);
        const h = parseInt(customHeight, 10);
        if (!isNaN(w) && !isNaN(h) && onDiagramSizeChange) {
            onDiagramSizeChange({ width: Math.max(100, w), height: Math.max(100, h) });
            setSizeDropdownOpen(false);
        }
    }, [customWidth, customHeight, onDiagramSizeChange]);

    return (
        <div className={`${P}-toolbar`}>
            {/* View toggle */}
            {hasViewToggle && (
                <>
                    <Tooltip title="View Diagram" placement="bottom">
                        <button
                            className={`${P}-toolbar-btn${activeView === 'diagram' ? ` ${P}-toolbar-btn--active` : ''}`}
                            onClick={() => onViewChange('diagram')}
                        >
                            <IconPicture />
                        </button>
                    </Tooltip>
                    <Tooltip title="Edit File (JSON)" placement="bottom">
                        <button
                            className={`${P}-toolbar-btn${activeView === 'file' ? ` ${P}-toolbar-btn--active` : ''}`}
                            onClick={() => onViewChange('file')}
                        >
                            <IconFile />
                        </button>
                    </Tooltip>
                    <span className={`${P}-toolbar-separator`} />
                </>
            )}

            {/* Copy/paste file */}
            {fileContent !== undefined && (
                <ToolbarButton text="Copy file" onClick={handleCopyFile} icon={copiedFile ? <IconCheck /> : <IconCopyFile />} prefix={P} />
            )}
            {onPasteFileContent && (
                <ToolbarButton text="Paste file" onClick={handlePasteFile} icon={pastedFile ? <IconCheck /> : <IconPasteFile />} prefix={P} />
            )}

            {/* Diagram-specific controls */}
            {isDiagramView && (
                <>
                    {onExportSVG && (
                        <ToolbarButton text="Download SVG" onClick={onExportSVG} icon={<IconDownload />} prefix={P} />
                    )}

                    {onFitToContent && (
                        <ToolbarButton text="Fit to content" onClick={onFitToContent} icon={<IconFitToContent />} prefix={P} />
                    )}

                    {onNormalizePositions && (
                        <ToolbarButton text="Normalize positions" onClick={onNormalizePositions} icon={<IconNormalize />} prefix={P} />
                    )}

                    {/* Run algorithms */}
                    {algorithms && algorithms.length > 0 && onRunAlgorithms && (
                        <>
                            <span className={`${P}-toolbar-separator`} />
                            <ToolbarButton text="Run algorithms" onClick={onRunAlgorithms} icon={<IconPlay />} prefix={P} />
                        </>
                    )}

                    {/* Size dropdown */}
                    {diagramSize && onDiagramSizeChange && (
                        <>
                            <span className={`${P}-toolbar-separator`} />
                            <div className={`${P}-toolbar-size-dropdown`} ref={sizeDropdownRef}>
                                <Tooltip title="Diagram size" placement="bottom">
                                    <button
                                        className={`${P}-toolbar-btn ${P}-toolbar-size-label`}
                                        onClick={() => setSizeDropdownOpen(o => !o)}
                                    >
                                        {currentSizeLabel}
                                    </button>
                                </Tooltip>
                                {sizeDropdownOpen && (
                                    <div className={`${P}-toolbar-size-menu`}>
                                        <div className={`${P}-toolbar-size-presets`}>
                                            {DIAGRAM_SIZE_PRESETS.map(preset => (
                                                <button
                                                    key={preset.label}
                                                    className={`${P}-toolbar-size-option${preset.width === diagramSize.width && preset.height === diagramSize.height ? ` ${P}-toolbar-size-option--active` : ''}`}
                                                    onClick={() => {
                                                        onDiagramSizeChange({ width: preset.width, height: preset.height });
                                                        setSizeDropdownOpen(false);
                                                    }}
                                                >
                                                    {preset.label}
                                                </button>
                                            ))}
                                        </div>
                                        <div className={`${P}-toolbar-size-separator`} />
                                        <div className={`${P}-toolbar-size-custom`}>
                                            <div className={`${P}-toolbar-size-inputs`}>
                                                <div className={`${P}-toolbar-size-field`}>
                                                    <label>W</label>
                                                    <input
                                                        type="number"
                                                        value={customWidth}
                                                        onChange={e => setCustomWidth(e.target.value)}
                                                        onKeyDown={e => e.key === 'Enter' && handleApplyCustomSize()}
                                                    />
                                                </div>
                                                <div className={`${P}-toolbar-size-field`}>
                                                    <label>H</label>
                                                    <input
                                                        type="number"
                                                        value={customHeight}
                                                        onChange={e => setCustomHeight(e.target.value)}
                                                        onKeyDown={e => e.key === 'Enter' && handleApplyCustomSize()}
                                                    />
                                                </div>
                                            </div>
                                            <button
                                                className={`${P}-toolbar-size-apply`}
                                                onClick={handleApplyCustomSize}
                                                disabled={isNaN(parseInt(customWidth)) || isNaN(parseInt(customHeight))}
                                            >
                                                Apply
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    <span className={`${P}-toolbar-separator`} />

                    {/* Zoom */}
                    <Tooltip title="Zoom out" placement="bottom">
                        <button className={`${P}-toolbar-btn`} onClick={zoomOut}><IconZoomOut /></button>
                    </Tooltip>
                    <Tooltip title="Reset zoom" placement="bottom">
                        <button className={`${P}-toolbar-btn ${P}-toolbar-zoom-label`} onClick={zoomReset}>
                            {Math.round(zoom * 100)}%
                        </button>
                    </Tooltip>
                    <Tooltip title="Zoom in" placement="bottom">
                        <button className={`${P}-toolbar-btn`} onClick={zoomIn}><IconZoomIn /></button>
                    </Tooltip>

                    {/* Theme */}
                    {onThemeChange && (
                        <>
                            <span className={`${P}-toolbar-separator`} />
                            <ToolbarButton
                                text={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
                                onClick={() => onThemeChange(theme === 'light' ? 'dark' : 'light')}
                                icon={theme === 'light' ? <IconMoon /> : <IconSun />}
                                prefix={P}
                            />
                        </>
                    )}
                </>
            )}
        </div>
    );
};
