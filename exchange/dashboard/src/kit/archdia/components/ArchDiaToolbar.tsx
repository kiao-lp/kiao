import React, { useState, useCallback, useRef, useEffect, useId } from 'react';
import {
    Tooltip, ToolbarButton, IconCopy, IconPaste, IconCopyFile, IconPasteFile,
    IconRefresh, IconDownload, IconZoomIn, IconZoomOut, IconCheck, IconFitToContent,
    IconNormalize, IconPicture, IconFile, IconSun, IconMoon,
} from '@kiao-dashboard-core';
import { DisplayOptions } from './ArchDiaSvgRenderer';

const IconMethods = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <text x="3" y="18" fontSize="16" fontFamily="monospace" fill="currentColor" stroke="none">f()</text>
    </svg>
);

const IconProperties = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
        <circle cx="4" cy="6" r="1.5" fill="currentColor" /><circle cx="4" cy="12" r="1.5" fill="currentColor" /><circle cx="4" cy="18" r="1.5" fill="currentColor" />
    </svg>
);

const IconTypes = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <text x="4" y="18" fontSize="18" fontFamily="serif" fontWeight="bold" fontStyle="italic" fill="currentColor" stroke="none">T</text>
    </svg>
);

const IconTreemap = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none">
        <rect x="2" y="2" width="20" height="20" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
        <rect x="4" y="4" width="6" height="16" rx="1" />
        <rect x="12" y="4" width="8" height="6" rx="1" />
        <rect x="12" y="12" width="8" height="8" rx="1" />
    </svg>
);

const IconPlantUml = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="2" width="6" height="4" rx="1" />
        <rect x="2" y="14" width="6" height="4" rx="1" /><rect x="16" y="14" width="6" height="4" rx="1" />
        <path d="M12 6v4M5 14v-4h14v4" />
    </svg>
);

export interface DiagramSizePreset {
    label: string;
    width: number;
    height: number;
}

export const DIAGRAM_SIZE_PRESETS: DiagramSizePreset[] = [
    { label: 'Small (640×480)',    width: 640,  height: 480 },
    { label: 'Medium (925×768)',   width: 925,  height: 768 },
    { label: 'Large (1280×960)',   width: 1280, height: 960 },
    { label: 'Wide (1600×900)',    width: 1600, height: 900 },
    { label: 'XL (1920×1080)',     width: 1920, height: 1080 },
];

export type ArchDiaView = 'diagram' | 'file';

export interface ArchDiaToolbarProps {
    /** Current active view. When provided with onViewChange, view toggle buttons appear. */
    activeView?: ArchDiaView;
    /** Called when the user clicks a view toggle button. */
    onViewChange?: (view: ArchDiaView) => void;
    /** Current source code (for copy-to-clipboard). */
    source?: string;
    /** Called when user pastes source from clipboard. */
    onPasteSource?: (source: string) => void;
    /** Current full file content (for copy-to-clipboard). */
    fileContent?: string;
    /** Called when user pastes file content from clipboard. */
    onPasteFileContent?: (content: string) => void;
    /** Called to refresh / reset the layout. */
    onRefreshLayout?: () => void;
    /** Called to fit the diagram size to its content. */
    onFitToContent?: () => void;
    /** Called to shift all elements so no x/y is negative. */
    onNormalizePositions?: () => void;
    /** Called to export / download SVG. */
    onExportSVG?: () => void;
    /** Called to apply the PlantUML layout. */
    onPlantUmlLayout?: () => void;
    /** Called to apply the Treemap layout. */
    onTreemapLayout?: () => void;
    /** Current display-options state. */
    displayOptions: DisplayOptions;
    /** Called when display options change. */
    onDisplayOptionsChange: (opts: DisplayOptions) => void;
    /** Current zoom level (0.25–2.0). */
    zoom: number;
    /** Called when zoom changes. */
    onZoomChange: (zoom: number) => void;
    /** Current diagram size. */
    diagramSize?: { width: number; height: number };
    /** Called when the user picks a new diagram size from the presets. */
    onDiagramSizeChange?: (size: { width: number; height: number }) => void;
    /** Current theme ('light' | 'dark'). */
    theme?: 'light' | 'dark';
    /** Called when the user toggles the theme. */
    onThemeChange?: (theme: 'light' | 'dark') => void;
}

export const ArchDiaToolbar: React.FC<ArchDiaToolbarProps> = ({
    activeView,
    onViewChange,
    source,
    onPasteSource,
    fileContent,
    onPasteFileContent,
    onRefreshLayout,
    onFitToContent,
    onNormalizePositions,
    onPlantUmlLayout,
    onTreemapLayout,
    onExportSVG,
    displayOptions,
    onDisplayOptionsChange,
    zoom,
    onZoomChange,
    diagramSize,
    onDiagramSizeChange,
    theme,
    onThemeChange,
}) => {
    const hasViewToggle = activeView !== undefined && onViewChange !== undefined;
    const isDiagramView = !hasViewToggle || activeView === 'diagram';
    const [copied, setCopied] = useState(false);
    const [pasted, setPasted] = useState(false);
    const [copiedFile, setCopiedFile] = useState(false);
    const [pastedFile, setPastedFile] = useState(false);
    const [sizeDropdownOpen, setSizeDropdownOpen] = useState(false);
    const sizeDropdownRef = useRef<HTMLDivElement>(null);

    // ── Custom size state ──
    const [customWidth, setCustomWidth] = useState<string>(diagramSize?.width?.toString() ?? '925');
    const [customHeight, setCustomHeight] = useState<string>(diagramSize?.height?.toString() ?? '768');
    const customSizeId = useId();
    const customWidthId = `${customSizeId}-w`;
    const customHeightId = `${customSizeId}-h`;

    // Sync custom values with props when they change (only if dropdown is closed)
    useEffect(() => {
        if (!sizeDropdownOpen && diagramSize) {
            setCustomWidth(diagramSize.width.toString());
            setCustomHeight(diagramSize.height.toString());
        }
    }, [diagramSize, sizeDropdownOpen]);

    // ── Size dropdown close on outside click ──
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
            ?? `${diagramSize.width}×${diagramSize.height}`
        : undefined;

    // ── Actions ──

    const handleCopy = useCallback(async () => {
        if (!source) return;
        try {
            await navigator.clipboard.writeText(source);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // clipboard not available — ignore
        }
    }, [source]);

    const handlePaste = useCallback(async () => {
        if (!onPasteSource) return;
        try {
            const text = await navigator.clipboard.readText();
            onPasteSource(text);
            setPasted(true);
            setTimeout(() => setPasted(false), 1500);
        } catch {
            // clipboard not available — ignore
        }
    }, [onPasteSource]);

    const handleCopyFile = useCallback(async () => {
        if (!fileContent) return;
        try {
            await navigator.clipboard.writeText(fileContent);
            setCopiedFile(true);
            setTimeout(() => setCopiedFile(false), 1500);
        } catch {
            // clipboard not available — ignore
        }
    }, [fileContent]);

    const handlePasteFile = useCallback(async () => {
        if (!onPasteFileContent) return;
        try {
            const text = await navigator.clipboard.readText();
            onPasteFileContent(text);
            setPastedFile(true);
            setTimeout(() => setPastedFile(false), 1500);
        } catch {
            // clipboard not available — ignore
        }
    }, [onPasteFileContent]);

    const toggleOption = useCallback(
        (key: keyof DisplayOptions) => {
            onDisplayOptionsChange({ ...displayOptions, [key]: !displayOptions[key] });
        },
        [displayOptions, onDisplayOptionsChange],
    );

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

    // ── Render ──

    return (
        <div className="archdia-toolbar">
            {/* View toggle */}
            {hasViewToggle && (
                <>
                    <button aria-label="View Diagram"
                        className={`archdia-toolbar-btn${activeView === 'diagram' ? ' archdia-toolbar-btn--active' : ''}`}
                        onClick={() => onViewChange('diagram')}
                    >
                        <IconPicture />
                    </button>
                    <button aria-label="Edit File (Raw)"
                        className={`archdia-toolbar-btn${activeView === 'file' ? ' archdia-toolbar-btn--active' : ''}`}
                        onClick={() => onViewChange('file')}
                    >
                        <IconFile />
                    </button>
                    <span className="archdia-toolbar-separator" />
                </>
            )}

            {/* Copy source */}
            {source !== undefined && (
                <ToolbarButton prefix="archdia" text="Copy source" onClick={handleCopy} icon={copied ? <IconCheck /> : <IconCopy />} />
            )}

            {/* Paste source */}
            {onPasteSource && (
                <ToolbarButton prefix="archdia" text="Paste source" onClick={handlePaste} icon={pasted ? <IconCheck /> : <IconPaste />} />
            )}

            {/* Copy file */}
            {fileContent !== undefined && (
                <ToolbarButton prefix="archdia" text="Copy file" onClick={handleCopyFile} icon={copiedFile ? <IconCheck /> : <IconCopyFile />} />
            )}

            {/* Paste file */}
            {onPasteFileContent && (
                <ToolbarButton prefix="archdia" text="Paste file" onClick={handlePasteFile} icon={pastedFile ? <IconCheck /> : <IconPasteFile />} />
            )}

            {/* Diagram-specific buttons — hidden when in file view */}
            {isDiagramView && (
                <>
                    {/* Refresh layout */}
                    {onRefreshLayout && (
                        <ToolbarButton prefix="archdia" text="Refresh layout" onClick={onRefreshLayout} icon={<IconRefresh />} />
                    )}

                    {/* PlantUML layout */}
                    {onPlantUmlLayout && (
                        <ToolbarButton prefix="archdia" text="PlantUML layout" onClick={onPlantUmlLayout} icon={<IconPlantUml />} />
                    )}

                    {/* Treemap layout */}
                    {onTreemapLayout && (
                        <ToolbarButton prefix="archdia" text="Treemap layout" onClick={onTreemapLayout} icon={<IconTreemap />} />
                    )}

                    {/* Export SVG */}
                    {onExportSVG && (
                        <ToolbarButton prefix="archdia" text="Download SVG" onClick={onExportSVG} icon={<IconDownload />} />
                    )}

                    {/* Fit to content */}
                    {onFitToContent && (
                        <ToolbarButton prefix="archdia" text="Fit to content" onClick={onFitToContent} icon={<IconFitToContent />} />
                    )}

                    {/* Normalize positions */}
                    {onNormalizePositions && (
                        <ToolbarButton prefix="archdia" text="Normalize positions" onClick={onNormalizePositions} icon={<IconNormalize />} />
                    )}

                    <span className="archdia-toolbar-separator" />

                    {/* Display toggles */}
                    <Tooltip title={displayOptions.showMethods ? 'Hide methods' : 'Show methods'} placement="bottom">
                        <button
                            className={`archdia-toolbar-btn ${displayOptions.showMethods ? 'archdia-toolbar-btn--active' : ''}`}
                            onClick={() => toggleOption('showMethods')}
                        >
                            <IconMethods />
                        </button>
                    </Tooltip>

                    <Tooltip title={displayOptions.showProperties ? 'Hide properties' : 'Show properties'} placement="bottom">
                        <button
                            className={`archdia-toolbar-btn ${displayOptions.showProperties ? 'archdia-toolbar-btn--active' : ''}`}
                            onClick={() => toggleOption('showProperties')}
                        >
                            <IconProperties />
                        </button>
                    </Tooltip>

                    <Tooltip title={displayOptions.showTypes ? 'Hide types' : 'Show types'} placement="bottom">
                        <button
                            className={`archdia-toolbar-btn ${displayOptions.showTypes ? 'archdia-toolbar-btn--active' : ''}`}
                            onClick={() => toggleOption('showTypes')}
                        >
                            <IconTypes />
                        </button>
                    </Tooltip>

                    {/* Diagram size dropdown */}
                    {diagramSize && onDiagramSizeChange && (
                        <>
                            <span className="archdia-toolbar-separator" />
                            <div className="archdia-toolbar-size-dropdown" ref={sizeDropdownRef}>
                                <button aria-label="Diagram size"
                                    className="archdia-toolbar-btn archdia-toolbar-size-label"
                                    onClick={() => setSizeDropdownOpen(o => !o)}
                                >
                                    {currentSizeLabel}
                                </button>
                                {sizeDropdownOpen && (
                                    <div className="archdia-toolbar-size-menu">
                                        <div className="archdia-toolbar-size-presets">
                                            {DIAGRAM_SIZE_PRESETS.map(preset => (
                                                <button
                                                    key={preset.label}
                                                    className={`archdia-toolbar-size-option${preset.width === diagramSize.width && preset.height === diagramSize.height ? ' archdia-toolbar-size-option--active' : ''}`}
                                                    onClick={() => {
                                                        onDiagramSizeChange({ width: preset.width, height: preset.height });
                                                        setSizeDropdownOpen(false);
                                                    }}
                                                >
                                                    {preset.label}
                                                </button>
                                            ))}
                                        </div>

                                        <div className="archdia-toolbar-size-separator" />

                                        <div className="archdia-toolbar-size-custom">
                                            <div className="archdia-toolbar-size-inputs">
                                                <div className="archdia-toolbar-size-field">
                                                    <label htmlFor={customWidthId}>W</label>
                                                    <input
                                                        id={customWidthId}
                                                        type="number"
                                                        value={customWidth}
                                                        onChange={e => setCustomWidth(e.target.value)}
                                                        onKeyDown={e => e.key === 'Enter' && handleApplyCustomSize()}
                                                    />
                                                </div>
                                                <div className="archdia-toolbar-size-field">
                                                    <label htmlFor={customHeightId}>H</label>
                                                    <input
                                                        id={customHeightId}
                                                        type="number"
                                                        value={customHeight}
                                                        onChange={e => setCustomHeight(e.target.value)}
                                                        onKeyDown={e => e.key === 'Enter' && handleApplyCustomSize()}
                                                    />
                                                </div>
                                            </div>
                                            <button
                                                className="archdia-toolbar-size-apply"
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

                    <span className="archdia-toolbar-separator" />

                    {/* Zoom controls */}
                    <button aria-label="Zoom out" className="archdia-toolbar-btn" onClick={zoomOut}>
                        <IconZoomOut />
                    </button>

                    <button aria-label="Reset zoom" className="archdia-toolbar-btn archdia-toolbar-zoom-label" onClick={zoomReset}>
                        {Math.round(zoom * 100)}%
                    </button>

                    <button aria-label="Zoom in" className="archdia-toolbar-btn" onClick={zoomIn}>
                        <IconZoomIn />
                    </button>

                    {/* Theme toggle */}
                    {onThemeChange && (
                        <>
                            <span className="archdia-toolbar-separator" />
                            <ToolbarButton prefix="archdia"
                                text={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
                                onClick={() => onThemeChange(theme === 'light' ? 'dark' : 'light')}
                                icon={theme === 'light' ? <IconMoon /> : <IconSun />}
                            />
                        </>
                    )}
                </>
            )}
        </div>
    );
};
