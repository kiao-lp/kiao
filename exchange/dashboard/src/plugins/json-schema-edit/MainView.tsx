import React, { useEffect } from 'react';
import {
    LayoutContent, TopBanner, extractFileNameFn, useFileBrowsingPersistenceContext,
    useTextFileSync, type MainViewCmp,
} from '@cms-core';
import { CodeMirrorJsonEditor, JSON_SCHEMA_META_SCHEMA } from '@cms-kit/code-editor';

const MainView: MainViewCmp = () => {
    const { currentFile } = useFileBrowsingPersistenceContext();
    const { content, loading, onChange } = useTextFileSync(currentFile?.path);

    useEffect(() => {
        if (currentFile) document.title = extractFileNameFn('.schema.json')(currentFile);
    }, [currentFile]);

    return <>
        <LayoutContent>
            <div className="json-schema-editor" style={{ height: '100%', width: '100%' }}>
                {loading ? <div>Loading...</div> : <CodeMirrorJsonEditor
                    value={content}
                    onChange={onChange}
                    schema={JSON_SCHEMA_META_SCHEMA}
                />}
            </div>
        </LayoutContent>
        <TopBanner />
    </>;
};

export default MainView;
