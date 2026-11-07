import React, { useState } from 'react';
import { Layout } from 'antd';
import { ToolBarTabRegistration } from '../toolbars/ToolBars-ctx';
import { ToolBarsSide } from '../toolbars/ToolBar-cmp';
import { CentralStackProvider, CentralStackView } from '../documents/CentralStack-ctx';
import { documentTab } from '../documents/DocumentPanel';
import { DocumentContentProvider } from '../documents/DocumentContent-ctx';
import { DocumentAreaProvider } from '../documents/DocumentArea-ctx';
import { useEmbeddedDocument } from '../documents/EmbeddedDocument-ctx';
import { ToolsMenuStackTarget } from '../top-banner/ToolsMenu-ctx';
import '../documents/Documents.css';

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
            <ToolsMenuStackTarget />
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
