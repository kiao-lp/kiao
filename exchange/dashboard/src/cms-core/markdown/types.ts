export type { LinkRenderer } from '../core/FileBasedPlugin';

/** A fenced code block the reader asked to edit, located in the markdown source. */
export interface EditableBlock {
    /** The fence's info string, e.g. `archdia`. */
    language: string;
    /** The block's body, fence markers excluded. */
    code: string;
    /** Offsets of the whole fence — markers included — within the rendered markdown. */
    range: { start: number; end: number };
}

export type BlockEditor = (block: EditableBlock) => void;

export type BlockExtractor = (block: EditableBlock) => void;
