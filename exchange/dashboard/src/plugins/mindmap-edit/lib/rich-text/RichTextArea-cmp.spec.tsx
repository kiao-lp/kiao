import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { parseSelectedText, RichTextAreaCmp } from "./RichTextArea-cmp";
import { writeDraggedFiles } from '../../../../cms-core/files/dnd/dragPaths';

// The drop handlers are the real ones: what the box has to agree with is the file navigator, and
// a mock of them would agree with nothing. See markdownLinkDrop.test for the writing of the link.
vi.mock('@cms-core', async () => ({
    VoiceTextArea: (props: any) => <textarea {...props} />,
    markdownLinkDropHandlers:
        (await import('../../../../cms-core/files/dnd/markdownLinkDrop')).markdownLinkDropHandlers,
}));

/** jsdom has no `DataTransfer`; what both ends of a drag use is a bag of types. */
const dragOf = (paths: string[]): DataTransfer => {
    const store: Record<string, string> = {};
    const data = {
        get types() { return Object.keys(store); },
        setData: (type: string, value: string) => { store[type] = value; },
        getData: (type: string) => store[type] ?? '',
        effectAllowed: 'none',
        dropEffect: 'none',
    } as unknown as DataTransfer;
    writeDraggedFiles(data, paths.map(path => ({ path, isDirectory: false })));
    return data;
};

describe('RichTextAreaCmp', () => {

    it('should return the text and selection offsets when markers present', () => {

        const { content, start, end } = parseSelectedText("This is {{{a selection test}}}");

        expect(content).toBe("This is a selection test");
        expect(start).toBe(8);
        expect(end).toBe(24);
    });

    it('should return null offsets when no markers present', () => {

        const { content, start, end } = parseSelectedText("This is a selection test");

        expect(content).toBe("This is a selection test");
        expect(start).toBe(null);
        expect(end).toBe(null);
    });

    // Ctrl+Enter is the way out of the popup with the keyboard alone: the map is told to close
    // it, and the newline Enter would otherwise have written is not added to the note.
    it('asks to be closed on Ctrl+Enter, and writes no newline', () => {
        const onClose = vi.fn();
        const { container } = render(<RichTextAreaCmp defaultValue="Note A" onClose={onClose} />);

        const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
        const notPrevented = fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(notPrevented).toBe(false);
    });

    // A note open for editing has its text in this box and no longer on the map, so the drop the
    // map takes as a note of its own is taken here as a link in the text being written.
    it('takes a file dragged out of the file navigator as a link where it is dropped', () => {
        render(<RichTextAreaCmp defaultValue="about " />);

        const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
        textarea.setSelectionRange(6, 6);
        fireEvent.drop(textarea, { dataTransfer: dragOf(['units/abc/cadre.md']) });

        expect(textarea.value).toBe('about [cadre.md](/units/abc/cadre.md)');
    });

    it('leaves a plain Enter to the textarea', () => {
        const onClose = vi.fn();
        render(<RichTextAreaCmp defaultValue="Note A" onClose={onClose} />);

        const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
        const notPrevented = fireEvent.keyDown(textarea, { key: 'Enter' });

        expect(onClose).not.toHaveBeenCalled();
        expect(notPrevented).toBe(true);
    });

});
