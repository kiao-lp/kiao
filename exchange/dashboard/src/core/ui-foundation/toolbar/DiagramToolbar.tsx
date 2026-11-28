import React, { useEffect, useState } from 'react';
import { themeMode, type KiaoTheme, type ThemeMode } from 'kiao-style';
import { getClipboardText } from '../clipboard/clipboard';
import { CopyTextButton } from '../clipboard/CopyButton';
import { ZoomControl } from '../zoom/ZoomControl';
import { DiagramSizePicker, type DiagramSize } from './DiagramSizePicker';
import { ToolbarButton, type ToolbarButtonProps } from './ToolbarButton';
import {
    IconCheck, IconCopyFile, IconDownload, IconFile, IconFitToContent,
    IconMoon, IconNormalize, IconPaste, IconPasteFile, IconPicture, IconSun,
} from './icons';
import './DiagramToolbar.css';

export type DiagramView = 'diagram' | 'file';

type DiagramAction = Omit<ToolbarButtonProps, 'prefix' | 'onClick'> & { onClick?: () => void };

interface DiagramToolbarProps {
    view?: { active: DiagramView; fileLabel: string; onChange: (view: DiagramView) => void };
    source?: string;
    onPasteSource?: (source: string) => void;
    fileContent?: string;
    onPasteFileContent?: (content: string) => void;
    layoutActions?: DiagramAction[];
    displayActions?: DiagramAction[];
    onExportSVG?: () => void;
    onFitToContent?: () => void;
    onNormalizePositions?: () => void;
    diagramSize?: DiagramSize;
    onDiagramSizeChange?: (size: DiagramSize) => void;
    sizePickerPlacement?: 'top' | 'bottom';
    zoom: number;
    onZoomChange: (zoom: number) => void;
    theme: KiaoTheme;
    onThemeChange?: (theme: ThemeMode) => void;
}

function DiagramButton(props: Omit<ToolbarButtonProps, 'prefix'>) {
    return <ToolbarButton prefix="diagram" {...props} />;
}

function PasteButton({ target, onPaste }: {
    target: 'source' | 'file';
    onPaste: (content: string) => void;
}) {
    const [successes, setSuccesses] = useState(0);
    useEffect(() => {
        if (!successes) return;
        const timer = setTimeout(() => setSuccesses(0), 1500);
        return () => clearTimeout(timer);
    }, [successes]);

    const paste = async () => {
        try {
            onPaste(await getClipboardText());
            setSuccesses(count => count + 1);
        } catch {
            // The browser can deny clipboard access.
        }
    };

    const icon = target === 'file' ? <IconPasteFile /> : <IconPaste />;
    return <DiagramButton text={`Paste ${target}`} icon={successes ? <IconCheck /> : icon} onClick={paste} />;
}

function ClipboardActions({ target, content, onPaste }: {
    target: 'source' | 'file';
    content?: string;
    onPaste?: (content: string) => void;
}) {
    return (
        <>
            {content !== undefined && (
                <CopyTextButton label={`Copy ${target}`} text={content} disabled={!content}
                    icon={target === 'file' ? <IconCopyFile /> : undefined}
                    type="plain" className="diagram-toolbar-btn" placement="bottom" tooltip />
            )}
            {onPaste && <PasteButton target={target} onPaste={onPaste} />}
        </>
    );
}

function ActionGroup({ actions }: { actions: DiagramAction[] }) {
    const buttons = actions.flatMap(({ onClick, ...action }) => onClick
        ? [<DiagramButton key={action.text} onClick={onClick} {...action} />]
        : []);
    return buttons.length > 0 ? <div className="diagram-toolbar-group">{buttons}</div> : null;
}

export function DiagramToolbar({
    view, source, onPasteSource, fileContent, onPasteFileContent,
    layoutActions = [], displayActions = [], onExportSVG, onFitToContent, onNormalizePositions,
    diagramSize, onDiagramSizeChange, sizePickerPlacement, zoom, onZoomChange, theme, onThemeChange,
}: DiagramToolbarProps) {
    const light = themeMode(theme) === 'light';
    return (
        <div className="diagram-toolbar" data-theme={theme}
            role="group" aria-label="Diagram controls">
            {view && (
                <div className="diagram-toolbar-group">
                    <DiagramButton text="View Diagram" icon={<IconPicture />} active={view.active === 'diagram'}
                        onClick={() => view.onChange('diagram')} />
                    <DiagramButton text={view.fileLabel} icon={<IconFile />} tooltip active={view.active === 'file'}
                        onClick={() => view.onChange('file')} />
                </div>
            )}
            {(source !== undefined || onPasteSource || fileContent !== undefined || onPasteFileContent) && (
                <div className="diagram-toolbar-group">
                    <ClipboardActions target="source" content={source} onPaste={onPasteSource} />
                    <ClipboardActions target="file" content={fileContent} onPaste={onPasteFileContent} />
                </div>
            )}
            {view?.active !== 'file' && (
                <>
                    <ActionGroup actions={layoutActions} />
                    <ActionGroup actions={[
                        { text: 'Download SVG', icon: <IconDownload />, onClick: onExportSVG },
                        { text: 'Fit to content', icon: <IconFitToContent />, tooltip: true, onClick: onFitToContent },
                        { text: 'Normalize positions', icon: <IconNormalize />, tooltip: true, onClick: onNormalizePositions },
                    ]} />
                    <ActionGroup actions={displayActions} />
                    {diagramSize && onDiagramSizeChange && (
                        <div className="diagram-toolbar-group">
                            <DiagramSizePicker size={diagramSize} onChange={onDiagramSizeChange}
                                theme={theme} placement={sizePickerPlacement} />
                        </div>
                    )}
                    <div className="diagram-toolbar-group">
                        <ZoomControl zoom={zoom} onZoomChange={onZoomChange} />
                    </div>
                    {onThemeChange && (
                        <div className="diagram-toolbar-group">
                            <DiagramButton text={light ? 'Switch to dark theme' : 'Switch to light theme'}
                                icon={light ? <IconMoon /> : <IconSun />}
                                onClick={() => onThemeChange(light ? 'dark' : 'light')} />
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
