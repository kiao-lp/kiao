/**
 * Demote section-breaking headings within the typing transaction to preserve caret and undo.
 * Create once per section rank at module level to avoid editor reconfiguration on render.
 */

import { EditorState, Extension } from '@codemirror/state';
import { strayHeadings } from './sections';

export const strayHeadingGuardOf = (rank: number): Extension => EditorState.transactionFilter.of(tr => {
    if (!tr.docChanged) return tr;
    const strays = strayHeadings(tr.newDoc.toString(), rank);
    if (strays.length === 0) return tr;

    // Offsets refer to tr.newDoc, so apply changes sequentially.
    return [tr, { sequential: true, changes: strays.map(({ at, fill }) => ({ from: at, insert: fill })) }];
});
