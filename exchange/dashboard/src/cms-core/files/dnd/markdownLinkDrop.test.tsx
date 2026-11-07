import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdownLinkDrop, markdownLinkDropHandlers } from './markdownLinkDrop';
import { writeDraggedFiles } from './dragPaths';

// jsdom has no DataTransfer; this stand-in stores type/value pairs.
const dataTransfer = (held: Record<string, string> = {}): DataTransfer => {
    const store = { ...held };
    return {
        get types() { return Object.keys(store); },
        setData: (type: string, value: string) => { store[type] = value; },
        getData: (type: string) => store[type] ?? '',
        effectAllowed: 'none',
        dropEffect: 'none',
    } as unknown as DataTransfer;
};

const dragOf = (paths: string[], folders: string[] = []): DataTransfer => {
    const data = dataTransfer();
    writeDraggedFiles(data, paths.map(path => ({ path, isDirectory: folders.includes(path) })));
    return data;
};

// Plain textarea cases.

const Box: React.FC<{ initial?: string; onChange?: (next: string) => void }> = ({ initial = '', onChange }) => {
    const [value, setValue] = React.useState(initial);
    const write = (next: string) => { setValue(next); onChange?.(next); };
    return (
        <textarea
            aria-label="message"
            value={value}
            onChange={event => write(event.target.value)}
            {...markdownLinkDropHandlers(value, write)}
        />
    );
};

const box = () => screen.getByLabelText('message') as HTMLTextAreaElement;

describe('a file dropped in a message box', () => {
    it('goes in as a link to it', () => {
        render(<Box />);
        fireEvent.drop(box(), { dataTransfer: dragOf(['units/abc/cadre.md']) });
        expect(box().value).toBe('[cadre.md](/units/abc/cadre.md)');
    });

    it('goes in where the caret is, the rest of the message staying where it was', () => {
        render(<Box initial="look at  before answering" />);
        box().setSelectionRange(8, 8);
        fireEvent.drop(box(), { dataTransfer: dragOf(['a.md']) });
        expect(box().value).toBe('look at [a.md](/a.md) before answering');
    });

    it('takes what a drag of several carries, all of it', () => {
        render(<Box />);
        fireEvent.drop(box(), { dataTransfer: dragOf(['a.md', 'b.md']) });
        expect(box().value).toBe('[a.md](/a.md) [b.md](/b.md)');
    });

    it('leaves a drag that is not the store’s to the browser', () => {
        const onChange = vi.fn();
        render(<Box onChange={onChange} />);
        const dropped = dataTransfer({ 'text/plain': 'some dragged prose' });
        fireEvent.drop(box(), { dataTransfer: dropped });
        expect(onChange).not.toHaveBeenCalled();
        expect(box().value).toBe('');
    });

    it('says yes to a drop of the store’s own, and nothing to any other', () => {
        render(<Box />);
        const ours = dragOf(['a.md']);
        const theirs = dataTransfer({ Files: '' });

        const taken = fireEvent.dragOver(box(), { dataTransfer: ours });
        // A dragover that is not defaultPrevented is a drop the browser refuses.
        expect(taken).toBe(false);
        expect(ours.dropEffect).toBe('copy');

        expect(fireEvent.dragOver(box(), { dataTransfer: theirs })).toBe(true);
    });

    it('keeps the drop from the panel around it, which is taking dropped files as attachments', () => {
        const onOuterDrop = vi.fn();
        render(<div onDrop={onOuterDrop}><Box /></div>);
        fireEvent.drop(box(), { dataTransfer: dragOf(['a.md']) });
        expect(onOuterDrop).not.toHaveBeenCalled();
    });
});

// CodeMirror cases.

const editor = (doc: string) => {
    const view = new EditorView({
        state: EditorState.create({ doc, extensions: [markdownLinkDrop] }),
        parent: document.body,
    });
    return view;
};

// jsdom has no layout, so drops fall back to the caret.
const dropOn = (view: EditorView, data: DataTransfer) => {
    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: data });
    view.contentDOM.dispatchEvent(event);
    return event;
};

describe('a file dropped in a flow node’s description', () => {
    it('goes in as a link, at the caret when the editor has no layout to point at', () => {
        const view = editor('before after');
        view.dispatch({ selection: { anchor: 7 } });

        dropOn(view, dragOf(['units/abc/cadre.md']));

        expect(view.state.doc.toString()).toBe('before [cadre.md](/units/abc/cadre.md)after');
        expect(view.state.selection.main.head).toBe(7 + '[cadre.md](/units/abc/cadre.md)'.length);
        view.destroy();
    });

    it('leaves a drag that is not the store’s to CodeMirror’s own drop', () => {
        const view = editor('untouched');
        const event = dropOn(view, dataTransfer({ 'text/plain': 'some dragged prose' }));
        expect(event.defaultPrevented).toBe(false);
        expect(view.state.doc.toString()).toBe('untouched');
        view.destroy();
    });
});
