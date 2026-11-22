export type { LinkRenderer } from '../extensibility/FileBasedPlugin';

export interface EditableBlock {
    language: string;
    code: string;
    // Offsets include fence markers.
    range: { start: number; end: number };
}

export type BlockEditor = (block: EditableBlock) => void;

export type BlockExtractor = (block: EditableBlock) => void;
