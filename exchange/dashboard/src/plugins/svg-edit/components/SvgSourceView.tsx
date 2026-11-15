import React from 'react';
import { useFileBrowsingPersistenceContext } from '@kiao-dashboard-core';
import { CodeMirrorCodeEditor } from '@kiao-dashboard-kit/code-editor';
import { useSvgStateContext } from '../state';

/** The file's text, as typed — the canvas's other side, and the invalid file's way back. */
export const SvgSourceView: React.FC = () => {
    const { text, onTextChange } = useSvgStateContext();
    const { currentFile } = useFileBrowsingPersistenceContext();

    return (
        <CodeMirrorCodeEditor
            value={text}
            onChange={onTextChange}
            path={currentFile?.path}
            style={{ height: '100%' }}
        />
    );
};
