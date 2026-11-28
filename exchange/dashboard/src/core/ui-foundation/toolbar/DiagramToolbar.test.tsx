/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as clipboard from '../clipboard/clipboard';
import { DiagramToolbar } from './DiagramToolbar';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const baseProps = { zoom: 1, onZoomChange: vi.fn(), theme: 'light' } as const;
const button = (name: string) => screen.getByRole('button', { name });

describe('DiagramToolbar', () => {
    it('keeps clipboard controls in file view and sends the selected view', () => {
        const onChange = vi.fn();
        render(<DiagramToolbar {...baseProps} view={{ active: 'file', fileLabel: 'Edit File (JSON)', onChange }}
            fileContent="{}" onPasteFileContent={vi.fn()} onExportSVG={vi.fn()} />);

        expect(button('Edit File (JSON)').getAttribute('aria-pressed')).toBe('true');
        expect(button('Copy file')).toBeTruthy();
        expect(button('Paste file')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Download SVG' })).toBeNull();
        expect(screen.queryByRole('combobox', { name: 'Zoom' })).toBeNull();
        fireEvent.click(button('View Diagram'));
        expect(onChange).toHaveBeenCalledWith('diagram');
    });

    it('routes source and file clipboard actions to their respective content', async () => {
        const write = vi.spyOn(clipboard, 'setClipboard').mockResolvedValue(undefined);
        vi.spyOn(clipboard, 'getClipboardText').mockResolvedValue('clipboard text');
        const onPasteSource = vi.fn();
        const onPasteFileContent = vi.fn();
        render(<DiagramToolbar {...baseProps} source="diagram source" fileContent="full file"
            onPasteSource={onPasteSource} onPasteFileContent={onPasteFileContent} />);

        fireEvent.click(button('Copy source'));
        fireEvent.click(button('Copy file'));
        fireEvent.click(button('Paste source'));
        fireEvent.click(button('Paste file'));

        await waitFor(() => {
            expect(write.mock.calls).toEqual([['diagram source'], ['full file']]);
            expect(onPasteSource).toHaveBeenCalledWith('clipboard text');
            expect(onPasteFileContent).toHaveBeenCalledWith('clipboard text');
            expect(screen.getAllByText('Copied')).toHaveLength(2);
        });
    });

    it.each([
        { width: '1200', height: '600', expected: { width: 1200, height: 600 } },
        { width: '50', height: '80', expected: { width: 100, height: 100 } },
    ])('applies $width×$height as $expected.width×$expected.height', ({ width, height, expected }) => {
        const onDiagramSizeChange = vi.fn();
        render(<DiagramToolbar {...baseProps} diagramSize={{ width: 925, height: 768 }}
            onDiagramSizeChange={onDiagramSizeChange} />);

        const size = button('Diagram size');
        fireEvent.click(size);
        const picker = within(screen.getByRole('group', { name: 'Diagram dimensions' }));
        fireEvent.change(picker.getByRole('spinbutton', { name: 'Width' }), { target: { value: width } });
        fireEvent.change(picker.getByRole('spinbutton', { name: 'Height' }), { target: { value: height } });
        fireEvent.click(picker.getByRole('button', { name: 'Apply' }));

        expect(onDiagramSizeChange).toHaveBeenCalledWith(expected);
        expect(size.getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(size);
    });

    it('discards unsubmitted dimensions on Escape and reopens with the latest size', () => {
        const onDiagramSizeChange = vi.fn();
        const toolbar = (width: number) => <DiagramToolbar {...baseProps} diagramSize={{ width, height: 768 }}
            onDiagramSizeChange={onDiagramSizeChange} />;
        const { rerender } = render(toolbar(925));

        const size = button('Diagram size');
        fireEvent.click(size);
        const width = screen.getByRole('spinbutton', { name: 'Width' });
        fireEvent.change(width, { target: { value: '' } });
        expect((button('Apply') as HTMLButtonElement).disabled).toBe(true);
        fireEvent.keyDown(width, { key: 'Escape' });
        expect(document.activeElement).toBe(size);
        expect(onDiagramSizeChange).not.toHaveBeenCalled();

        rerender(toolbar(1200));
        fireEvent.click(size);
        expect((screen.getByRole('spinbutton', { name: 'Width' }) as HTMLInputElement).value).toBe('1200');
    });
});
