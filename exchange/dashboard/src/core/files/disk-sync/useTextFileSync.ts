import { DocumentCodec, useDocumentFileSync } from './useDocumentFileSync';

export interface TextFileSync {
    content: string;
    /** True until the first read completes. */
    loading: boolean;
    /** Updates content and schedules a write. */
    onChange: (text: string) => void;
}

/** Identity codec: text is its own document. */
const TEXT_CODEC: DocumentCodec<string> = { parse: text => text, serialize: text => text };

/** `useDocumentFileSync` under the identity codec. */
export const useTextFileSync = (path: string | undefined): TextFileSync => {
    const { text, loading, onTextChange } = useDocumentFileSync(path, TEXT_CODEC);
    return { content: text, loading, onChange: onTextChange };
};
