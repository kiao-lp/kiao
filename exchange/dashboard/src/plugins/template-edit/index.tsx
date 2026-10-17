import React, { ReactNode } from 'react';
import {
    FileDto,
    CmsPlugin,
    extractFileNameFn,
    useFileBrowsingPersistenceContext,
    useFileViewState,
    FileLabelCmp,
    MainViewCmp,
    LayoutContent,
    TopBanner,
} from '@cms-core';

import iconImg from './template-icon.svg';

import { TemplatePersistenceProvider } from './TemplatePersistence-ctx';
import { TemplateEditor } from './TemplateEditor';
import { TemplateStatusBar, TemplateEditMode } from './TemplateStatusBar';
import { useTemplatePersistenceContext } from './TemplatePersistence-ctx';
import { TemplateCollectionV0 } from '@cms-kit/template-lang';
import { TemplateEmbed } from './components/TemplateEmbed';
import { TemplateCreationPlugin } from './TemplateCreationPlugin';
import { TEMPLATE_EXTENSION } from './instantiationTarget';


const extension = TEMPLATE_EXTENSION;

const GlobalProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const { currentFile } = useFileBrowsingPersistenceContext();

    if (!currentFile) {
        return null;
    }

    return (
        <TemplatePersistenceProvider templateId={currentFile.path}>
            {children}
        </TemplatePersistenceProvider>
    );
};

const fileLabelCmp: FileLabelCmp = ({ file }) =>
    <><img src={iconImg} className="file-label-icon" alt={extractFileNameFn(extension)(file)} />{extractFileNameFn(extension)(file)}</>;

const MainView: MainViewCmp = () => {
    const { template, flush } = useTemplatePersistenceContext();
    const { currentFile } = useFileBrowsingPersistenceContext();

    React.useEffect(() => {
        if (currentFile) document.title = extractFileNameFn(extension)(currentFile);
    }, [currentFile]);

    // Remembered per template file.
    const [view, setView] = useFileViewState('template', { mode: 'edit' as TemplateEditMode });
    const mode = view.mode;
    const setMode = (m: TemplateEditMode) => setView({ mode: m });
    const prevTemplateRef = React.useRef<TemplateCollectionV0 | null>(null);

    // Auto-switch to instantiate mode if template has content
    React.useEffect(() => {
        if (prevTemplateRef.current === null && template?.rootTemplate?.textTemplate) {
            setMode('instantiate');
        }
        prevTemplateRef.current = template;
    }, [template]);



    // Ctrl+S has little left to do — the edit is already on its way — but the browser's own
    // "save page" dialog must not open, and writing right away is what the reflex asks for.
    React.useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 's') {
                event.preventDefault();
                flush();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [flush]);

    const statusBarContent = <TemplateStatusBar mode={mode} setMode={setMode} />;

    return (
        <>
            <LayoutContent>
                <TemplateEditor mode={mode} />
            </LayoutContent>
            <TopBanner additionalPanels={statusBarContent} />
        </>
    );
};

const fileConfigFor = (file: FileDto) => file.path.endsWith(extension) ? {

    fileLabelCmp,
    mainView: MainView,
    withGlobalProvider: (jsx: ReactNode) => <GlobalProvider>{jsx}</GlobalProvider>
} : null;


// Adapt TemplateEmbed to the LinkRenderer signature (title required, isLink accepted).
// TemplateEmbed only reads id + title, so this forwards exactly what it used before.
const TemplateEmbedRenderer: React.FC<{ id: string, title: string, isLink?: boolean }> = ({ id, title }) => (
    <TemplateEmbed id={id} title={title} />
);

const markdownRenderers = {
    template: TemplateEmbedRenderer
};

export const plugin: CmsPlugin = {
    id: 'template-edit',
    fileConfigFor,
    fileExtensions: [extension],
    markdownRenderers,
    CreationProvider: TemplateCreationPlugin,
};
