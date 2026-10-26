/**
 * Text fragments — a passage of a document named by the words it is made of, carried in a URL.
 *
 * `textDirective.ts` holds the grammar and the vocabulary; start there.
 */
export { parseTextFragment, textFragmentOf, linkToPassage } from './textDirective';
export type { TextDirective } from './textDirective';
export { useTextFragment } from './useTextFragment';
export type { TextFragmentState } from './useTextFragment';
export { PassageContextMenu } from './PassageContextMenu';
export type { PassageContextMenuProps } from './PassageContextMenu';
