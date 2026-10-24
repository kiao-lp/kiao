import React, { useState } from 'react';
import { Layout } from 'antd';
import { ToolBarTabRegistration } from '../tool-bars/ToolBars-ctx';
import { ToolBarsSide } from '../tool-bars/ToolBar-cmp';
import { CentralStackProvider, CentralStackView } from './CentralStack-ctx';
import { documentTab } from './DocumentPanel';
import { DocumentContentProvider } from './DocumentContent-ctx';
import { DocumentAreaProvider } from './DocumentArea-ctx';
import { useEmbeddedDocument } from './EmbeddedDocument-ctx';

/**
 * The left, central and right panel areas. The document is pinned to the first central area.
 */
export const LayoutContent = ({ children, additionalPanels }: {
    children: React.ReactNode;
    /** Controls belonging to the document tab. */
    additionalPanels?: React.ReactNode;
}) => {
    const embedded = useEmbeddedDocument();
    const [documentArea, setDocumentArea] = useState<HTMLDivElement | null>(null);

    if (embedded) {
        return <DocumentAreaProvider element={documentArea}>
            <CentralStackProvider>
                <div className="cms-document-area" ref={setDocumentArea}>
                    {additionalPanels && <div className="cms-tool-bar-controls">{additionalPanels}</div>}
                    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
                        {children}
                    </div>
                    <CentralStackView />
                </div>
            </CentralStackProvider>
        </DocumentAreaProvider>;
    }

    return <DocumentAreaProvider element={documentArea}>
        <CentralStackProvider>
            <DocumentContentProvider value={{ content: children, additionalPanels, areaRef: setDocumentArea }}>
                <ToolBarTabRegistration tab={documentTab} />
                <Layout.Content style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden' }} className='main-area'>
                    <ToolBarsSide side="left" />
                    <ToolBarsSide side="center" />
                    <ToolBarsSide side="right" />
                </Layout.Content>
            </DocumentContentProvider>
        </CentralStackProvider>
    </DocumentAreaProvider>;
};
