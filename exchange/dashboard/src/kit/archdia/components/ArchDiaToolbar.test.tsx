/** @vitest-environment jsdom */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { ArchDiaToolbar } from './ArchDiaToolbar';

// Vitest runs without globals here, so Testing Library cannot register its own
// afterEach — unmount explicitly or a second render duplicates the markup.
afterEach(cleanup);

describe('ArchDiaToolbar custom size', () => {
    const onDiagramSizeChange = vi.fn();
    const defaultProps = {
        displayOptions: { showMethods: true, showProperties: true, showTypes: true },
        onDisplayOptionsChange: vi.fn(),
        zoom: 1.0,
        onZoomChange: vi.fn(),
        diagramSize: { width: 925, height: 768 },
        onDiagramSizeChange,
    };

    it('allows entering and applying a custom size', () => {
        render(<ArchDiaToolbar {...defaultProps} />);

        // Open the size dropdown
        const sizeLabel = screen.getByText('Medium (925×768)');
        fireEvent.click(sizeLabel);

        // Find the custom size inputs
        const widthInput = screen.getByLabelText('W');
        const heightInput = screen.getByLabelText('H');
        const applyButton = screen.getByText('Apply');

        // Enter new values
        fireEvent.change(widthInput, { target: { value: '1200' } });
        fireEvent.change(heightInput, { target: { value: '600' } });

        // Click Apply
        fireEvent.click(applyButton);

        expect(onDiagramSizeChange).toHaveBeenCalledWith({ width: 1200, height: 600 });
    });

    it('enforces a minimum size of 100x100', () => {
        render(<ArchDiaToolbar {...defaultProps} />);

        // Open the size dropdown
        const sizeLabel = screen.getByText('Medium (925×768)');
        fireEvent.click(sizeLabel);

        const widthInput = screen.getByLabelText('W');
        const heightInput = screen.getByLabelText('H');
        const applyButton = screen.getByText('Apply');

        fireEvent.change(widthInput, { target: { value: '50' } });
        fireEvent.change(heightInput, { target: { value: '50' } });
        fireEvent.click(applyButton);

        expect(onDiagramSizeChange).toHaveBeenCalledWith({ width: 100, height: 100 });
    });
});
