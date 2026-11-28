import React from 'react';
import { CodeMirrorCodeEditor, useFileBrowsingPersistenceContext, useTextFileSync } from '@kiao-dashboard-core';

export const CodeEditor: React.FC = () => {
    const { currentFile } = useFileBrowsingPersistenceContext();
    const { content, loading, onChange } = useTextFileSync(currentFile?.path);

    if (loading) return <div>Loading...</div>;

    return (
        <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
            <div style={{ flex: 1, overflow: 'hidden', backgroundColor: 'var(--bg)' }}>
                <CodeMirrorCodeEditor
                    value={content}
                    onChange={onChange}
                    path={currentFile?.path}
                />
            </div>
        </div>
    );
};
