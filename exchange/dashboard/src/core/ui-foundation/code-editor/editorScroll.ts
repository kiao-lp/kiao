/**
 * Reading and writing a CodeMirror pane's scroll position in line coordinates,
 * shared by the editors that keep two panes showing the same content.
 */

import type { EditorView } from '@codemirror/view';

/**
 * CodeMirror measures vertically from the top of the document rather than from
 * the scroller, so both directions convert through this height coordinate.
 */
export const documentHeightAtTop = (view: EditorView): number =>
    Math.max(0, view.scrollDOM.getBoundingClientRect().top - view.documentTop);

/** The (fractional) line at the top of the pane — 3.5 is halfway down line 3. */
export const editorTopLine = (view: EditorView): number => {
    const height = documentHeightAtTop(view);
    const block = view.lineBlockAtHeight(height);
    const line = view.state.doc.lineAt(block.from).number;
    const fraction = block.height > 0 ? Math.min(Math.max((height - block.top) / block.height, 0), 1) : 0;
    return line + fraction;
};

/** How far the pane must scroll to bring the (fractional) `line` to its top. */
export const editorScrollDelta = (view: EditorView, line: number): number => {
    const doc = view.state.doc;
    const lineNumber = Math.min(Math.max(Math.floor(line), 1), doc.lines);
    const block = view.lineBlockAt(doc.line(lineNumber).from);
    const target = block.top + (line - lineNumber) * block.height;
    return target - documentHeightAtTop(view);
};
