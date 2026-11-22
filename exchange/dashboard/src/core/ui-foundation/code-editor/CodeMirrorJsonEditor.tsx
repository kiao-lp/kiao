import React, { forwardRef, useMemo } from 'react';
import { CodeMirrorCodeEditor, type CodeMirrorCodeEditorProps, type CodeMirrorCodeEditorRef } from './CodeMirrorCodeEditor';
import { jsonSchemaExtensions, type JsonSchema } from './jsonSchemaSupport';

export type CodeMirrorJsonEditorRef = CodeMirrorCodeEditorRef;

export interface CodeMirrorJsonEditorProps extends Omit<CodeMirrorCodeEditorProps, 'path'> {
    /** A document's $schema overrides this default. */
    schema?: JsonSchema;
}

export const CodeMirrorJsonEditor = forwardRef<CodeMirrorJsonEditorRef, CodeMirrorJsonEditorProps>(
    ({ schema, extensions, ...props }, ref) => {
        const allExtensions = useMemo(() => [
            ...jsonSchemaExtensions(schema),
            ...(extensions ?? []),
        ], [schema, extensions]);

        return <CodeMirrorCodeEditor {...props} ref={ref} extensions={allExtensions} />;
    },
);

CodeMirrorJsonEditor.displayName = 'CodeMirrorJsonEditor';
