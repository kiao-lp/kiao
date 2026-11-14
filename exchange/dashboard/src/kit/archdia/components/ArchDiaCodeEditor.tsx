import React from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView } from '@codemirror/view';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';

export interface ArchDiaCodeEditorProps {
    value: string;
    onChange?: (value: string) => void;
}

export const ArchDiaCodeEditor: React.FC<ArchDiaCodeEditorProps> = ({ value, onChange }) => (
    <div className="archdia-code-editor">
        <CodeMirror
            value={value}
            onChange={onChange}
            extensions={[
                markdown({ base: markdownLanguage, codeLanguages: languages }),
                EditorView.lineWrapping,
                EditorView.theme({
                    '&': { height: '100%' },
                    '.cm-scroller': { overflow: 'auto' },
                }),
            ]}
            theme={vscodeDark}
            style={{ height: '100%', width: '100%' }}
            basicSetup={{
                lineNumbers: true,
                bracketMatching: true,
                closeBrackets: true,
                searchKeymap: true,
            }}
        />
    </div>
);
