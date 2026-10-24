import React from 'react';
import { useFileBrowsingPersistenceContext, useTextFileSync, CodeMirrorTextEditor } from '@cms-core';

export const TextEditor: React.FC = () => {
    const { currentFile } = useFileBrowsingPersistenceContext();
    const { content, loading, onChange } = useTextFileSync(currentFile?.path);

    if (loading) return <div>Loading...</div>;

    return (
        <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
            <div style={{ flex: 1, overflow: 'hidden', backgroundColor: 'var(--bg)' }}>
                <CodeMirrorTextEditor
                    value={content}
                    onChange={onChange}
                />
            </div>
        </div>
    );
};
