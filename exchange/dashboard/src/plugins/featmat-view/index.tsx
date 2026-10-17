import React, { useEffect, useRef } from 'react';
import {
    FileDto,
    CmsPlugin,
    extractFileNameFn,
    FileLabelCmp,
    MainViewCmp,
    LayoutContent,
    TopBanner,
    useDocumentFileSync,
    useFileBrowsingPersistenceContext,
    useFileViewState,
    useScrollMemory
} from '@cms-core';

import { FeatMatrix } from './featmat';
import type { Feature, Option, RequirementList } from './featmat';
import './featmat-view.css';

import { CodeMirrorJsonEditor } from '@cms-kit/code-editor';

import { Spin, Segmented } from 'antd';
import { TableOutlined, CodeOutlined } from '@ant-design/icons';
import iconImg from './icon.svg';

const extension = ".fmat.json";

type Mode = 'view' | 'edit';

interface FeatMatData {
    features: Feature[];
    options: Option[];
    requirements?: RequirementList[];
}

const fileLabelCmp: FileLabelCmp = ({ file }) => {
    const fileTitle = extractFileNameFn(extension)(file);
    return <><img src={iconImg} className="file-label-icon" alt={fileTitle} style={{ marginRight: 4, height: 16 }} />{fileTitle}</>;
};

// The bridge between the file's text and the matrix. Only the JSON source is edited today;
// the serialization arrow exists because the codec is two-way.
const FEATMAT_CODEC = {
    parse: (text: string) => JSON.parse(text) as FeatMatData,
    serialize: (data: FeatMatData) => JSON.stringify(data, null, 2),
};

const MainView: MainViewCmp = () => {
    const { currentFile } = useFileBrowsingPersistenceContext();

    // Reading, debounced saving and following the file on disk: the shared hook does it all.
    const { doc: parsedData, text: rawContent, loading, onTextChange } =
        useDocumentFileSync(currentFile?.path, FEATMAT_CODEC);

    // Table or JSON source, remembered per matrix.
    const [view, setView] = useFileViewState('featmat', { mode: 'view' as Mode });
    const tableRef = useRef<HTMLDivElement>(null);
    useScrollMemory(tableRef, 'featmat.table', view.mode === 'view');
    const mode = view.mode;
    const setMode = (m: Mode) => setView({ mode: m });

    useEffect(() => {
        if (currentFile) document.title = extractFileNameFn(extension)(currentFile);
    }, [currentFile]);

    const bannerPanel = (
        <Segmented
            size="small"
            value={mode}
            onChange={(v) => setMode(v as Mode)}
            options={[
                { value: 'view', icon: <TableOutlined /> },
                { value: 'edit', icon: <CodeOutlined /> },
            ]}
        />
    );

    return (
        <>
            <LayoutContent>
                {loading
                    ? <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}><Spin /></div>
                    : mode === 'edit'
                        ? <CodeMirrorJsonEditor value={rawContent} onChange={onTextChange} />
                        : parsedData
                            ? <div ref={tableRef} style={{ padding: 16, overflow: 'auto', height: '100%' }}>
                                <FeatMatrix
                                    features={parsedData.features}
                                    options={parsedData.options}
                                    requirements={parsedData.requirements}
                                />
                            </div>
                            : <div style={{ padding: 20, color: 'var(--code, red)' }}>Invalid JSON — switch to edit mode to fix.</div>
                }
            </LayoutContent>
            <TopBanner additionalPanels={bannerPanel} />
        </>
    );
};

const fileConfigFor = (file: FileDto) => file.path.endsWith(extension) ? {
    fileLabelCmp,
    mainView: MainView,
} : null;

export const plugin: CmsPlugin = {
    id: 'featmat-view',
    fileConfigFor,
    fileExtensions: [extension],
};
