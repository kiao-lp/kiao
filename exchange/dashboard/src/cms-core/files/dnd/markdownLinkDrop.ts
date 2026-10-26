/**
 * The other end of a drag out of the file tree: a place that writes text, taking what was dropped
 * on it as a **markdown link** to the file rather than as the file itself.
 *
 * A CodeMirror and a plain `<textarea>` want the same thing said in two ways, so both are here: the
 * link goes in where it was dropped, and the caret lands after it, ready to be typed against.
 *
 * Neither of them touches a drag that is not ours — text dragged from a web page keeps the ordinary
 * drop it has always had, which is that text, dropped.
 */

import type React from 'react';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { holdsDraggedFiles, markdownLinksOf, readDraggedFiles } from './dragPaths';

/** The drop is a copy: the file stays where it is, and only a link to it is written. */
const asCopy = (event: React.DragEvent | DragEvent): void => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
};

/**
 * Where in the document the drop landed, and the caret when the editor cannot say.
 *
 * `posAtCoords` reads the point off the laid-out lines, so it has no answer for a point outside
 * them — and none at all for an editor nothing has laid out yet, where it throws rather than
 * answers. Either way the link goes in at the caret: a drop that lands nowhere is still a drop.
 */
const droppedAt = (view: EditorView, event: DragEvent): number => {
    try {
        return view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
    } catch {
        return view.state.selection.main.head;
    }
};

/**
 * CodeMirror's side of it, as an extension to hand to an editor that is edited with files around —
 * a flow node's description, say.
 *
 * `dragover` says yes to the drop and then stands down rather than claiming the event, so that
 * CodeMirror still draws the drop cursor that shows where the link is about to land. `drop` claims
 * it: what goes in is the link, not the path the drag also carries as plain text.
 */
export const markdownLinkDrop: Extension = EditorView.domEventHandlers({
    dragover(event) {
        if (!holdsDraggedFiles(event.dataTransfer)) return false;
        asCopy(event);
        return false;
    },
    drop(event, view) {
        const dropped = readDraggedFiles(event.dataTransfer);
        if (!dropped.length) return false;
        asCopy(event);
        const at = droppedAt(view, event);
        const text = markdownLinksOf(dropped);
        view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length } });
        view.focus();
        return true;
    },
});

/** What a `<textarea>` needs to take the same drop, spread onto it. */
export interface MarkdownLinkDropHandlers {
    onDragOver: (event: React.DragEvent<HTMLTextAreaElement>) => void;
    onDrop: (event: React.DragEvent<HTMLTextAreaElement>) => void;
}

/**
 * A `<textarea>`'s side of it, over the value it is showing and the call that writes it back.
 *
 * The link goes in at the box's own caret, which is where the browser has been putting it while the
 * drag moved over the box — that is what the caret follows a drag for. A box that was never focused
 * has its caret at the start, and that is where the link lands.
 *
 * The drop is stopped from going any further up: the panel around the box may be taking dropped
 * *files* as attachments, and this drop is not one.
 */
export const markdownLinkDropHandlers = (
    value: string,
    onChange: (next: string) => void,
): MarkdownLinkDropHandlers => ({
    onDragOver: event => {
        if (!holdsDraggedFiles(event.dataTransfer)) return;
        asCopy(event);
    },
    onDrop: event => {
        const dropped = readDraggedFiles(event.dataTransfer);
        if (!dropped.length) return;
        asCopy(event);
        event.stopPropagation();
        const box = event.currentTarget;
        const at = Math.min(box.selectionStart ?? value.length, value.length);
        const text = markdownLinksOf(dropped);
        onChange(`${value.slice(0, at)}${text}${value.slice(at)}`);
        // After the render that carries the new value: setting the caret on the box as it stands
        // would be setting it in text about to be replaced.
        requestAnimationFrame(() => {
            box.focus();
            box.setSelectionRange(at + text.length, at + text.length);
        });
    },
});
