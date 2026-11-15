import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ZoomTargetProvider, useZoomTarget } from './ZoomTarget-ctx';
import { ZoomSlider } from './ZoomSlider';

/** The slider's own tooltip says the same number, so the readout is asked for by name. */
const readout = () => document.querySelector('.cms-zoom-readout')?.textContent;

const Factor: React.FC = () => <span data-testid="factor">{useZoomTarget().factor}</span>;

const banner = () => render(
    <ZoomTargetProvider>
        <div id="message" data-zoomable="">a reply</div>
        <ZoomSlider />
        <Factor />
    </ZoomTargetProvider>
);

/** How the reader picks a target: a click with Ctrl held down. */
const ctrlClick = (element: HTMLElement) => fireEvent.click(element, { ctrlKey: true });

describe('ZoomSlider', () => {
    it('is not in the banner until something is selected', () => {
        banner();
        expect(screen.queryByRole('slider')).toBeNull();

        ctrlClick(screen.getByText('a reply'));
        expect(screen.getByRole('slider')).toBeInTheDocument();
        expect(readout()).toBe('125%');
    });

    it('magnifies by one step per key, and reads out what it is at', () => {
        banner();
        ctrlClick(screen.getByText('a reply'));

        fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight', keyCode: 39, which: 39 });

        expect(screen.getByTestId('factor').textContent).toBe('1.3');
        expect(readout()).toBe('130%');
    });

    it('goes away with the selection', () => {
        banner();
        ctrlClick(screen.getByText('a reply'));
        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByRole('slider')).toBeNull();
    });
});
