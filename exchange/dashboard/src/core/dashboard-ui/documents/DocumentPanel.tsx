import React, { useCallback, useEffect, useRef } from 'react';
import { Button } from 'antd';
import { CloseOutlined, FileOutlined } from '@ant-design/icons';
import { FileSearchResultsStackPanel } from '../../files/browser/FileSearchResultsView';
import { useFileBrowsingPersistenceContext } from '../../files/core/FileBrowsingPersistence-ctx';
import { useNavigation } from '../../files/navigation/NavigationModel';
import { CENTER_BAR_ID } from '../toolbars/barsModel';
import { ToolBarTab, useToolBarsOptional } from '../toolbars/ToolBars-ctx';
import { GitDiffStackPanel } from '../../git/GitDiffStackPanel';
import { useCentralStack } from './CentralStack-ctx';
import { DOCUMENT_TAB_ID, useDocumentContent } from './DocumentContent-ctx';

const CloseDocumentButton = () => {
    const nav = useNavigation();
    const { currentPath } = useFileBrowsingPersistenceContext();
    const handleClose = useCallback(() => {
        nav.open(currentPath);
    }, [nav, currentPath]);
    return <Button
        className="cms-close-document"
        type="text"
        icon={<CloseOutlined />}
        onClick={handleClose}
        aria-label="Close document"
        data-testid="close-document"
    />;
};

export const DocumentPanel: React.FC = () => {
    const { content, areaRef } = useDocumentContent();
    const { currentFile } = useFileBrowsingPersistenceContext();
    // Stack panels cover this button with their own close.
    const closable = !!currentFile && !currentFile.isDirectory;
    const bars = useToolBarsOptional();
    const barsRef = useRef(bars);
    barsRef.current = bars;
    const { panels } = useCentralStack();

    // Document-hosted panel shows the document tab on arrival.
    const topPanel = panels.length === 0 ? null : panels[panels.length - 1];
    const top = topPanel?.id ?? null;
    const topHost = topPanel?.host ?? DOCUMENT_TAB_ID;
    useEffect(() => {
        const current = barsRef.current;
        if (!current || top === null || topHost !== DOCUMENT_TAB_ID) return;
        if (current.activeIn(CENTER_BAR_ID) === DOCUMENT_TAB_ID) return;
        current.showTab(DOCUMENT_TAB_ID);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [top]);

    return (
        <div className="cms-document-area" ref={areaRef}>
            {/* Plugins without their own scroller scroll here. */}
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
                {content}
            </div>
            <GitDiffStackPanel />
            <FileSearchResultsStackPanel />
            {closable && <CloseDocumentButton />}
        </div>
    );
};

/** Pinned first in the centre bar; not in the Show menu. */
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
