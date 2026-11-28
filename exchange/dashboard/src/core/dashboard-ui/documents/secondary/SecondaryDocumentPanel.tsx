import React, { useEffect, useRef } from 'react';
import { IconButton } from '../../../ui-foundation/toolbar/IconButton';
import { CloseOutlined, FileOutlined } from '@ant-design/icons';
import { parentPath } from '../../../files/service';
import { ScopedFileBrowsingProvider } from '../../../files/core/FileBrowsingPersistence-ctx';
import { usePluginListContext } from '../../../extensibility/PluginList-ctx';
import { ActivePluginProvider } from '../../../extensibility/ActivePlugin';
import { EmbeddedDocumentProvider } from '../EmbeddedDocument-ctx';
import { CENTER_2_BAR_ID } from '../../toolbars/barsModel';
import type { ToolBarTab } from '../../toolbars/ToolBars-ctx';
import { useToolBarsOptional } from '../../toolbars/ToolBars-ctx';
import { useSecondaryDocument, useSecondaryDocumentOptional } from './SecondaryDocument-ctx';
import type { FileTypeConfig } from '../../../extensibility/FileBasedPlugin';

export const SECONDARY_DOCUMENT_TAB_ID = 'secondary-document';

export const SecondaryDocumentPanel: React.FC = () => {
    const { file, close } = useSecondaryDocument();
    const { findFilePlugin } = usePluginListContext();

    if (!file) {
        return (
            <div className="cms-document-area" data-testid="secondary-document-panel">
                <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', padding: 16 }}>
                    No secondary document
                </div>
            </div>
        );
    }

    const plugin = findFilePlugin(file);
    const config = plugin?.fileConfigFor(file) ?? null;

    return (
        <div className="cms-document-area" data-testid="secondary-document-panel">
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {config ? (
                    <ScopedFileBrowsingProvider
                        value={{ currentFile: file, currentPath: parentPath(file.path) }}
                    >
                        <EmbeddedDocumentProvider>
                            <ActivePluginProvider>
                                <SecondaryMainView key={file.path} config={config} />
                            </ActivePluginProvider>
                        </EmbeddedDocumentProvider>
                    </ScopedFileBrowsingProvider>
                ) : (
                    <div style={{ padding: 16 }}>No viewer for this file</div>
                )}
            </div>
            <IconButton
                label="Close secondary document"
                size="middle"
                className="cms-close-document"
                icon={<CloseOutlined />}
                onClick={close}
                data-testid="close-secondary-document"
            />
        </div>
    );
};

const SecondaryMainView: React.FC<{ config: FileTypeConfig }> = ({ config }) => {
    const MainView = config.mainView;
    return <>{config.withGlobalProvider ? config.withGlobalProvider(<MainView />) : <MainView />}</>;
};

export const secondaryDocumentTab: ToolBarTab = {
    id: SECONDARY_DOCUMENT_TAB_ID,
    title: 'Secondary document',
    icon: <FileOutlined />,
    defaultBar: CENTER_2_BAR_ID,
    pinned: true,
    flush: true,
    forceRender: true,
    render: () => <SecondaryDocumentPanel />,
};

export const SecondaryDocumentReveal: React.FC = () => {
    const secondary = useSecondaryDocumentOptional();
    const bars = useToolBarsOptional();
    const revealedFor = useRef<string | null>(null);
    const path = secondary?.file?.path ?? null;

    useEffect(() => {
        if (!path || !bars || revealedFor.current === path) return;
        if (!bars.secondCentralArea) {
            bars.setSecondCentralArea(true);
            return;
        }
        revealedFor.current = path;
        bars.showTab(SECONDARY_DOCUMENT_TAB_ID);
    }, [path, bars]);

    return null;
};
