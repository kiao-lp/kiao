import React, { ReactNode } from 'react';
import { Spin } from 'antd';

import {
    CmsPlugin,
    extractName,
    FileDto,
    FileLabelCmp,
    LayoutContent,
    MainViewCmp,
    TopBanner,
    useFileBrowsingPersistenceContext,
    lazyComponent,
} from '@cms-core';

import './styles.css';
import iconImg from './icon.svg';

import { SvgStateProvider, useSvgStateContext } from './state';
import { SvgHotkeysProvider } from './hotkeys';
import { SvgViewport } from './components/SvgViewport';
import { NewShapeControl, SvgViewControl, SvgZoomControl } from './components/SvgControls';
import { SvgCreationPlugin } from './SvgCreationPlugin';

const SvgSourceView = lazyComponent(() => import('./components/SvgSourceView').then(m => ({ default: m.SvgSourceView })));


const extension = '.svg';


const SvgMainView: React.FC = () => {
    const { loading, document, mode } = useSvgStateContext();

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <Spin />
            </div>
        );
    }

    if (!document) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{ padding: '8px 16px', color: 'var(--fg)', background: 'var(--accent-bg)' }}>
                    Not a valid SVG file — fix the source below, or open it in a code editor.
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                    <SvgSourceView />
                </div>
            </div>
        );
    }

    return mode === 'canvas' ? <SvgViewport /> : <SvgSourceView />;
};

const mainView: MainViewCmp = () => {
    const { currentFile } = useFileBrowsingPersistenceContext();

    React.useEffect(() => {
        if (currentFile) document.title = extractName(currentFile.path) || 'SVG image';
    }, [currentFile]);

    return (
        <>
            <LayoutContent additionalPanels={
                <><NewShapeControl /><SvgViewControl /><SvgZoomControl /></>
            }>
                <SvgMainView />
            </LayoutContent>
            <TopBanner />
        </>
    );
};


const GlobalProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const { currentFile } = useFileBrowsingPersistenceContext();

    if (!currentFile) {
        return <>{children}</>;
    }

    return (
        <SvgStateProvider svgId={currentFile.path}>
            <SvgHotkeysProvider>
                {children}
            </SvgHotkeysProvider>
        </SvgStateProvider>
    );
};


const fileLabelCmp: FileLabelCmp = ({ file }) => {
    const fileTitle = extractName(file.path);
    return <><img src={iconImg} className="file-label-icon" alt={fileTitle} />{fileTitle}</>;
};


const fileConfigFor = (file: FileDto) => file.path.toLowerCase().endsWith(extension) ? {
    fileLabelCmp,
    mainView,
    withGlobalProvider: (jsx: ReactNode) => <GlobalProvider>{jsx}</GlobalProvider>,
} : null;

export const plugin = {
    id: 'svg-edit',
    fileConfigFor,
    fileExtensions: [extension],
    CreationProvider: SvgCreationPlugin,
} satisfies CmsPlugin;
