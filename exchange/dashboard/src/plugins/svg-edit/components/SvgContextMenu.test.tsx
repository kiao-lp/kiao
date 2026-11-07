import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const svgState = vi.hoisted(() => ({ value: null as any }));
const selectionState = vi.hoisted(() => ({ value: ['r1'] as string[], set: vi.fn() }));

vi.mock('../state', async () => {
    const actual = await vi.importActual<typeof import('../state')>('../state');
    return { ...actual, useSvgStateContext: () => svgState.value };
});

vi.mock('@cms-core', () => ({
    useSelectionContext: () => [selectionState.value, selectionState.set],
}));

import { SvgContextMenu } from './SvgContextMenu';

const drawingOf = () => ({
    canvas: { width: 800, height: 600 },
    nodes: [
        { kind: 'shape', shape: { id: 'r1', tag: 'rect', attrs: { x: '10', y: '20', width: '120', height: '60' } } },
        { kind: 'shape', shape: { id: 't1', tag: 'text', text: 'Hi', attrs: { x: '10', y: '20', 'font-size': '20' } } },
    ],
});

const spies = vi.hoisted(() => ({
    setDocument: vi.fn(),
    saveSvg: vi.fn(),
    addShapes: vi.fn(),
    deleteShapes: vi.fn(),
    restackShapes: vi.fn(),
    onClose: vi.fn(),
}));

beforeEach(() => {
    vi.clearAllMocks();
    selectionState.value = ['r1'];
    svgState.value = {
        document: { drawing: drawingOf(), rootAttrs: {} },
        setDocument: spies.setDocument,
        saveSvg: spies.saveSvg,
        addShapes: spies.addShapes,
        deleteShapes: spies.deleteShapes,
        restackShapes: spies.restackShapes,
    };
});

const show = () => render(<SvgContextMenu anchor={{ x: 100, y: 100 }} onClose={spies.onClose} />);

describe('SvgContextMenu', () => {
    it('offers the shape verbs with their standard keys', () => {
        show();
        expect(screen.getByText('Duplicate')).toBeTruthy();
        expect(screen.getByText('Bring to front')).toBeTruthy();
        expect(screen.getByText('Send to back')).toBeTruthy();
        expect(screen.getByText('Delete')).toBeTruthy();
        expect(screen.getByText('Ctrl+D')).toBeTruthy();
        expect(screen.getByText('Ctrl+Shift+F')).toBeTruthy();
        expect(screen.getByText('Ctrl+Shift+B')).toBeTruthy();
    });

    it('brings the selection to front and closes', () => {
        show();
        fireEvent.click(screen.getByText('Bring to front'));
        expect(spies.restackShapes).toHaveBeenCalledWith(['r1'], 'front');
        expect(spies.saveSvg).toHaveBeenCalled();
        expect(spies.onClose).toHaveBeenCalled();
    });

    it('sends the selection to back and closes', () => {
        show();
        fireEvent.click(screen.getByText('Send to back'));
        expect(spies.restackShapes).toHaveBeenCalledWith(['r1'], 'back');
        expect(spies.saveSvg).toHaveBeenCalled();
        expect(spies.onClose).toHaveBeenCalled();
    });

    it('duplicates the selection beside itself and closes', () => {
        show();
        fireEvent.click(screen.getByText('Duplicate'));
        expect(spies.addShapes).toHaveBeenCalledTimes(1);
        const [copies] = spies.addShapes.mock.calls[0];
        expect(copies).toHaveLength(1);
        expect(copies[0].attrs.x).toBe('30');
        expect(copies[0].attrs.y).toBe('40');
        expect(spies.saveSvg).toHaveBeenCalled();
        expect(spies.onClose).toHaveBeenCalled();
    });

    it('deletes the selection and closes', () => {
        show();
        fireEvent.click(screen.getByText('Delete'));
        expect(spies.deleteShapes).toHaveBeenCalledWith(['r1']);
        expect(spies.saveSvg).toHaveBeenCalled();
        expect(spies.onClose).toHaveBeenCalled();
    });

    it('offers text sizes only when a text is selected', () => {
        show();
        expect(screen.queryByText('Text larger')).toBeNull();

        selectionState.value = ['t1'];
        show();
        expect(screen.getByText('Text larger')).toBeTruthy();
        expect(screen.getByText('Text smaller')).toBeTruthy();
    });

    it('grows the selected text and closes', () => {
        selectionState.value = ['t1'];
        show();
        fireEvent.click(screen.getByText('Text larger'));
        expect(spies.setDocument).toHaveBeenCalledTimes(1);
        const updater = spies.setDocument.mock.calls[0][0];
        const next = updater(svgState.value.document);
        const text = next.drawing.nodes[1].shape;
        expect(text.attrs['font-size']).toBe('22');
        expect(spies.saveSvg).toHaveBeenCalled();
        expect(spies.onClose).toHaveBeenCalled();
    });
});
