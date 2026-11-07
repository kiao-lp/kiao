import React, { forwardRef } from 'react';
import { useFileBrowsingPersistenceContext } from '@cms-core';
import { MarkdownEditorBody, MarkdownEditorBodyProps, MarkdownEditorBodyRef } from '@cms-kit/markdown-editor';
import { useMarkdownDocument } from './MarkdownDocument';

export type { EditorMode } from '@cms-kit/markdown-editor';

/**
 * What the host chooses about the panes, handed straight to the body — taken from its props rather
 * than restated, so a control added there reaches the open file without a stop here.
 */
export type MarkdownFileEditorProps = Pick<
    MarkdownEditorBodyProps,
    'showSource' | 'showPreview' | 'editorMode' | 'syncScroll' | 'previewZoom'
>;

/**
 * `.md` file editor: renders the shared, file-agnostic body over the document state shared
 * with the metadata controls by MarkdownDocumentProvider.
 */
export const MarkdownFileEditor = forwardRef<MarkdownEditorBodyRef, MarkdownFileEditorProps>(
    (props, ref) => {
        const { currentFile } = useFileBrowsingPersistenceContext();
        const { content, loading, onChange } = useMarkdownDocument();

        if (loading) return <div>Loading...</div>;

        const pdfTitle = currentFile?.path.split('/').pop()?.replace(/\.md$/, '') || 'document';

        return (
            <MarkdownEditorBody
                ref={ref}
                value={content}
                onChange={onChange}
                pdfTitle={pdfTitle}
                {...props}
                // The preview here *is* the open file, so a passage of it has a URL: this is where
                // a `#text=` link resolves, and where one is copied from.
                passageLinks
            />
        );
    }
);

MarkdownFileEditor.displayName = 'MarkdownFileEditor';
