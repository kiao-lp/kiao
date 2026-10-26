import { DocumentCodec, useDocumentFileSync } from './useDocumentFileSync';

export interface TextFileSync {
    /** The file's text, as the editor must show it. */
    content: string;
    /** True until the first read lands; the editor has nothing to draw before that. */
    loading: boolean;
    /** Every edit goes through here: it moves `content` and schedules the write. */
    onChange: (text: string) => void;
}

/** Text is its own document: the identity codec is all that "as text" means to the machinery. */
const TEXT_CODEC: DocumentCodec<string> = { parse: text => text, serialize: text => text };

/**
 * Open a file as text, save it as it is typed, and follow it while it is open —
 * `useDocumentFileSync` under the identity codec, which is the whole difference. Written for the
 * plain text editors (markdown, text, code), which differ only in the component they draw.
 */
export const useTextFileSync = (path: string | undefined): TextFileSync => {
    const { text, loading, onTextChange } = useDocumentFileSync(path, TEXT_CODEC);
    return { content: text, loading, onChange: onTextChange };
};
