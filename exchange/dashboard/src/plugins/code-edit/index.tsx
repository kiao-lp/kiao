import React, { useEffect } from 'react';
import {
    FileDto,
    CmsPlugin,
    FileLabelCmp,
    MainViewCmp,
    LayoutContent,
    TopBanner,

    useFileBrowsingPersistenceContext,
    extractName,
} from '@cms-core';
import { CodeEditor } from './CodeEditor';
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

// Generic code files handled by this plugin, each named by the icon of its language. Kept generic
// (not claimed by a more specific plugin) and intentionally listed last in App.tsx. Highlighting
// is not declared here: CodeMirrorCodeEditor resolves it from the file name through
// @codemirror/language-data, which covers every extension below but `.gitignore` and the Go
// module files — those open as plain code, which is all their line-based syntax asks for.
// `.gitignore` and the Go module files are whole file names rather than suffixes, and matching
// is by `endsWith`, so they need no special case here.
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

// The extensions a label drops. A source file keeps its own: `index.ts`, `index.tsx` and
// `index.js` sit side by side in one folder, and stripped they would read as one name three times.
// A configuration file keeps its own for the same reason — `application.yml` next to
// `application.properties` — and `.gitignore`, being all extension, would be left with no label.
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

export const plugin: CmsPlugin = {
    id: 'code-edit',
    fileConfigFor,
    fileExtensions: supportedExtensions,
    // Every one of these is a generic claim: `.json` is any JSON, and a `.mmap.json` is a
    // document some other plugin owns. So this plugin is looked at only once every specific
    // claimant has passed on the file.
    fallback: true,
};
