import React, { useState } from 'react';
import { Layout } from 'antd';
import { ToolBarTabRegistration } from '../tool-bars/ToolBars-ctx';
import { ToolBarsSide } from '../tool-bars/ToolBar-cmp';
import { CentralStackProvider } from './CentralStack-ctx';
import { DocumentContentProvider, documentTab } from './DocumentPanel';
import { DocumentAreaProvider } from './DocumentArea-ctx';

/**
 * The whole chrome around a document: the top bar, then the row of left column, central area and
 * right column. The centre is a bar like the other two: it holds the document — registered here,
 * pinned, leading whatever else the document puts beside it — and disappears like them when it
 * holds none, which is only ever before the registration lands.
 *
 * A plugin main view renders `<LayoutContent>` with its editor inside and `<TopBanner/>` beside it;
 * the banner floats to the very top by CSS order, so the DOM order here is the visual one.
 */
export const LayoutContent = ({ children }: { children: React.ReactNode }) => {
    // Held in state rather than in a ref: what it is handed to is a render — a dialog rendered
    // into the central area (DocumentArea-ctx) — and the element only exists after the first one.
    // The bars are inside the provider too, since that is where such a dialog is opened.
    const [documentArea, setDocumentArea] = useState<HTMLDivElement | null>(null);

    return <DocumentAreaProvider element={documentArea}>
        <CentralStackProvider>
            <DocumentContentProvider value={{ content: children, areaRef: setDocumentArea }}>
                <ToolBarTabRegistration tab={documentTab} />
                <ToolBarsSide side="top" />
                <Layout.Content style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden' }} className='main-area'>
                    <ToolBarsSide side="left" />
                    <ToolBarsSide side="center" />
                    <ToolBarsSide side="right" />
                </Layout.Content>
            </DocumentContentProvider>
        </CentralStackProvider>
    </DocumentAreaProvider>;
};
