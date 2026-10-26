import React, { useRef } from 'react';
import { useFileBrowsingPersistenceContext, useTextFileSync } from '@cms-core';
import { CodeMirrorCodeEditor, CodeMirrorCodeEditorRef } from '@cms-kit/code-editor';

export const CodeEditor: React.FC = () => {
    const { currentFile } = useFileBrowsingPersistenceContext();
    const { content, loading, onChange } = useTextFileSync(currentFile?.path);
    const editorRef = useRef<CodeMirrorCodeEditorRef>(null);

    if (loading) return <div>Loading...</div>;

    return (
        <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
            <div style={{ flex: 1, overflow: 'hidden', backgroundColor: 'var(--bg)' }}>
                <CodeMirrorCodeEditor
                    ref={editorRef}
                    value={content}
                    onChange={onChange}
                    path={currentFile?.path}
                />
            </div>
        </div>
    );
};
