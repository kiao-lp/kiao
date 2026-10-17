import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { Button } from 'antd';
import { CloseOutlined, FileOutlined } from '@ant-design/icons';
import { FileOptimizationsStackPanel } from '../file-optimizations/FileOptimizationsView';
import { FileSearchResultsStackPanel } from '../files/browser/FileSearchResultsView';
import { useFileBrowsingPersistenceContext } from '../files/core/FileBrowsingPersistence-ctx';
import { useNavigation } from '../files/navigation/NavigationModel';
import { CENTER_BAR_ID } from '../tool-bars/barsModel';
import { ToolBarTab, useToolBarsOptional } from '../tool-bars/ToolBars-ctx';
import { GitDiffStackPanel } from '../toolbar/GitDiffView';
import { useScrollMemory } from '../view-state';
import { CentralStackView, useCentralStack } from './CentralStack-ctx';
import { Tooltip } from '../ui/Tooltip';

/** The tab the open document is: pinned to the centre, leading whatever else is put there. */
export const DOCUMENT_TAB_ID = 'document';

interface DocumentContentValue {
    /** What the open document draws — the editor the main view rendered the layout with. */
    content: React.ReactNode;
    /** Where the document panel's own element goes: `LayoutContent` publishes it as the area
     *  dialogs belonging to the document render into. */
    areaRef: (element: HTMLDivElement | null) => void;
}

const DocumentContentContext = createContext<DocumentContentValue | null>(null);

const useDocumentContent = (): DocumentContentValue => {
    const context = useContext(DocumentContentContext);
    if (!context) throw new Error('DocumentPanel must be drawn by the layout that provides its content');
    return context;
};

export const DocumentContentProvider: React.FC<{
    value: DocumentContentValue;
    children?: React.ReactNode;
}> = ({ value, children }) => (
    <DocumentContentContext.Provider value={value}>{children}</DocumentContentContext.Provider>
);

/**
 * Closing the open document. It floats over the top-right corner of the document itself
 * rather than sitting among the navigation bar entries: the cross belongs to what it
 * closes, and that is where the hand already is.
 */
const CloseDocumentButton = () => {
    const nav = useNavigation();
    const { currentPath } = useFileBrowsingPersistenceContext();
    const handleClose = useCallback(() => {
        nav.open(currentPath);
    }, [nav, currentPath]);
    return <Tooltip title="Close">
        <Button
            className="cms-close-document"
            type="text"
            icon={<CloseOutlined />}
            onClick={handleClose}
            aria-label="Close document"
            data-testid="close-document"
        />
    </Tooltip>;
};

/**
 * The document as a tab of the central area: the open document — or the folder's listing, or a
 * plugin's folder view — with the central area's stack over it.
 *
 * It is registered by `LayoutContent` as a tab pinned to the centre, so the centre is a bar like
 * the left and right ones: by default the document is the only tab in it and no tab strip shows,
 * and from the first tab put beside it the document has a tab of its own. The content is read
 * from a context rather than captured in the registration, so what the layout holds is what the
 * tab shows — a registration is made once, navigation is not.
 */
export const DocumentPanel: React.FC = () => {
    const { content, areaRef } = useDocumentContent();
    const { currentFile, currentPath } = useFileBrowsingPersistenceContext();
    // A pushed panel covers this cross with its own, so it stays drawn under the stack.
    const closable = !!currentFile && !currentFile.isDirectory;
    // The shared scroller: plugins that do not create one of their own scroll
    // here, so remembering it covers them all without any per-plugin work.
    const contentRef = useRef<HTMLDivElement>(null);
    useScrollMemory(contentRef, 'main');

    const bars = useToolBarsOptional();
    const barsRef = useRef(bars);
    barsRef.current = bars;
    const { panels } = useCentralStack();

    // Opening a file opens it in the document panel: when the browsing lands somewhere else while
    // another tab of the centre is showing, the document is brought back in front — a click in the
    // file tree that left a panel covering the file just opened would read as a click that did
    // nothing. Only the browsing is watched: a tab chosen by hand afterwards must not be taken
    // back, so the bars are read off a mirror rather than depended on.
    const openKey = currentFile?.path ?? currentPath;
    useEffect(() => {
        const current = barsRef.current;
        if (!current || current.activeIn(CENTER_BAR_ID) === DOCUMENT_TAB_ID) return;
        current.showTab(DOCUMENT_TAB_ID);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openKey]);

    // A panel pushed on the stack covers the document and nothing else, so when one arrives while
    // another tab of the centre is showing, the document is brought back in front with it — the
    // search results opened from the top banner while the Git tab is up, say. Only arrivals are
    // watched: closing back, or a tab chosen over the stack, is left alone.
    const top = panels.length === 0 ? null : panels[panels.length - 1].id;
    useEffect(() => {
        const current = barsRef.current;
        if (!current || top === null || current.activeIn(CENTER_BAR_ID) === DOCUMENT_TAB_ID) return;
        current.showTab(DOCUMENT_TAB_ID);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [top]);

    return (
        <div className="cms-document-area" ref={areaRef}>
            <div ref={contentRef} style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
                {content}
            </div>
            {/* The stack over the document: panels pushed from the document or the bars.
                Above the document's own cross, which the top panel covers and replaces
                with its own. */}
            <CentralStackView />
            {/* The application modes as stack panels: the git diff, the file
                optimizations view and the file search results open over whatever this
                panel is showing — a document, a board — and close back onto it. They are
                followed here rather than in each main view, so every one of them
                answers them. */}
            <GitDiffStackPanel />
            <FileOptimizationsStackPanel />
            <FileSearchResultsStackPanel />
            {closable && <CloseDocumentButton />}
        </div>
    );
};

/**
 * The document's registration: pinned to the centre, leading it, never offered by the Show menu.
 * The content is the layout's own, read live — see `DocumentPanel`.
 */
export const documentTab: ToolBarTab = {
    id: DOCUMENT_TAB_ID,
    title: 'Document',
    icon: <FileOutlined />,
    defaultBar: CENTER_BAR_ID,
    pinned: true,
    flush: true,
    forceRender: true,
    render: () => <DocumentPanel />,
};
