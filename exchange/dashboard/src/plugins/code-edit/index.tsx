import React, { useEffect } from 'react';
import {
    FileDto,
    CmsPlugin,
    lazyComponent,
    FileLabelCmp,
    MainViewCmp,
    LayoutContent,
    TopBanner,

    useFileBrowsingPersistenceContext,
    extractName,
} from '@cms-core';
import jsonIcon from './json-icon.svg';
import shellIcon from './shell-icon.svg';
import typescriptIcon from './typescript-icon.svg';
import javascriptIcon from './javascript-icon.svg';
import javaIcon from './java-icon.svg';
import rustIcon from './rust-icon.svg';
import goIcon from './go-icon.svg';
import pythonIcon from './python-icon.svg';
import kotlinIcon from './kotlin-icon.svg';
import xmlIcon from './xml-icon.svg';
import yamlIcon from './yaml-icon.svg';
import propertiesIcon from './properties-icon.svg';
import sqlIcon from './sql-icon.svg';
import gitIcon from './git-icon.svg';

const CodeEditor = lazyComponent(() => import('./CodeEditor').then(m => ({ default: m.CodeEditor })));

// Fallback plugin: must stay last in App.tsx so specific plugins claim first.
// Keys match by `endsWith`, so whole names (`go.mod`, `.gitignore`) need no special case.
const iconByExtension: Record<string, string> = {
    '.json': jsonIcon,
    '.sh': shellIcon,
    '.bash': shellIcon,
    '.ts': typescriptIcon,
    '.tsx': typescriptIcon,
    '.mts': typescriptIcon,
    '.cts': typescriptIcon,
    '.js': javascriptIcon,
    '.jsx': javascriptIcon,
    '.mjs': javascriptIcon,
    '.cjs': javascriptIcon,
    '.java': javaIcon,
    '.rs': rustIcon,
    '.go': goIcon,
    'go.mod': goIcon,
    'go.sum': goIcon,
    'go.work': goIcon,
    'go.work.sum': goIcon,
    '.py': pythonIcon,
    '.kt': kotlinIcon,
    '.kts': kotlinIcon,
    '.xml': xmlIcon,
    '.yml': yamlIcon,
    '.yaml': yamlIcon,
    '.properties': propertiesIcon,
    '.sql': sqlIcon,
    '.gitignore': gitIcon,
};

const supportedExtensions = Object.keys(iconByExtension);

// Other extensions stay in labels to avoid duplicate or empty names.
const extensionsDroppedFromTitle = ['.json', '.sh', '.bash'];

const extensionOf = (path: string) => {
    const lowerPath = path.toLowerCase();
    return supportedExtensions.find(ext => lowerPath.endsWith(ext)) ?? null;
};

const iconFor = (path: string) => {
    const extension = extensionOf(path);
    return extension ? iconByExtension[extension] : undefined;
};

const fileTitleFor = (path: string) => {
    const name = extractName(path);
    const extension = extensionOf(name);
    return extension && extensionsDroppedFromTitle.includes(extension)
        ? name.substring(0, name.length - extension.length)
        : name;
};

const fileLabelCmp: FileLabelCmp = ({ file }) => {
    const fileTitle = fileTitleFor(file.path);
    const icon = iconFor(file.path);
    return <>{icon && <img src={icon} className="file-label-icon" alt={fileTitle} />}{fileTitle}</>;
};

const MainView: MainViewCmp = () => {
    const { currentFile } = useFileBrowsingPersistenceContext();

    useEffect(() => {
        if (currentFile) document.title = fileTitleFor(currentFile.path);
    }, [currentFile]);

    return (
        <>
            <LayoutContent>
                <CodeEditor />
            </LayoutContent>
            <TopBanner />
        </>
    );
};

const fileConfigFor = (file: FileDto) => extensionOf(file.path) ? {
    fileLabelCmp,
    mainView: MainView,
} : null;

export const plugin = {
    id: 'code-edit',
    fileConfigFor,
    fileExtensions: supportedExtensions,
    // Generic claims only: specific plugins must claim first.
    fallback: true,
} satisfies CmsPlugin;
