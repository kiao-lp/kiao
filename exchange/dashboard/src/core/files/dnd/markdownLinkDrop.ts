// Drops insert a markdown link at the drop point; non-store drags keep the default drop.

import type React from 'react';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { holdsDraggedFiles, markdownLinksOf, readDraggedFiles } from './dragPaths';

const asCopy = (event: React.DragEvent | DragEvent): void => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
};

// `posAtCoords` may return null or throw without layout; fall back to the caret.
const droppedAt = (view: EditorView, event: DragEvent): number => {
    try {
        return view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
    } catch {
        return view.state.selection.main.head;
    }
};

/** CodeMirror extension that inserts a markdown link on store drops. `dragover` allows the drop without claiming it, so the drop cursor still shows. */
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

export interface MarkdownLinkDropHandlers {
    onDragOver: (event: React.DragEvent<HTMLTextAreaElement>) => void;
    onDrop: (event: React.DragEvent<HTMLTextAreaElement>) => void;
}

/** Textarea handlers that insert a markdown link at the caret. Stops propagation so an outer drop target does not treat the drop as an attachment. */
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
        // Set the caret after the render with the new value.
        requestAnimationFrame(() => {
            box.focus();
            box.setSelectionRange(at + text.length, at + text.length);
        });
    },
});
