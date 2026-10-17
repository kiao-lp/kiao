import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CentralStackProvider, CentralStackView, useCentralStack } from './CentralStack-ctx';

/**
 * The central area's stack. What it owes whoever pushes is three things: the panel lands over
 * whatever is showing, closing it is back where that was — state and all — and nothing outside
 * the area is ever blocked by it.
 */

const onCloseA = vi.fn();
const onCloseB = vi.fn();

/** A panel holding something typed, so going back can be read off it. */
const Draft: React.FC = () => {
    const [text, setText] = useState('');
    return (
        <input
            data-testid="draft"
            value={text}
            aria-label="Draft"
            onChange={event => setText(event.target.value)}
        />
    );
};

const outside = vi.fn();

/** The area and its chrome: the stack over the document, a button of the chrome beside it. */
const Area: React.FC = () => {
    const { push, close } = useCentralStack();
    return (
        <div>
            <button data-testid="outside" onClick={() => outside()}>Outside</button>
            <button data-testid="push-a" onClick={() => push({ id: 'a', title: 'First', content: <Draft />, onClose: onCloseA })}>A</button>
            <button
                data-testid="push-b"
                onClick={() => push({ id: 'b', title: 'Second', closeLabel: 'Cancel', content: 'second panel', onClose: onCloseB })}
            >
                B
            </button>
            <button data-testid="close-a" onClick={() => close('a')}>Close A</button>
            <button data-testid="close-missing" onClick={() => close('missing')}>Close missing</button>
            <div data-testid="document">the document</div>
            <CentralStackView />
        </div>
    );
};

const area = () => render(<CentralStackProvider><Area /></CentralStackProvider>);

const panel = (id: string) => screen.getByTestId(`central-panel-${id}`);

describe('CentralStack — pushing and closing', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('draws nothing on an empty stack', () => {
        area();
        expect(screen.queryByTestId('central-stack')).toBeNull();
        expect(screen.getByTestId('document')).toBeInTheDocument();
    });

    it('lands a pushed panel over the document, titled and closable', () => {
        area();
        fireEvent.click(screen.getByTestId('push-a'));

        expect(panel('a')).toHaveTextContent('First');
        expect(panel('a')).toHaveAttribute('role', 'dialog');
        expect(screen.getByTestId('central-panel-a-close')).toHaveAccessibleName('Close');
    });

    it('closes through the floating cross, firing onClose once', () => {
        area();
        fireEvent.click(screen.getByTestId('push-a'));
        fireEvent.click(screen.getByTestId('central-panel-a-close'));

        expect(screen.queryByTestId('central-panel-a')).toBeNull();
        expect(onCloseA).toHaveBeenCalledTimes(1);
    });

    it('closes through the hook, wherever the panel sits', () => {
        area();
        fireEvent.click(screen.getByTestId('push-a'));
        fireEvent.click(screen.getByTestId('push-b'));
        fireEvent.click(screen.getByTestId('close-a'));

        expect(screen.queryByTestId('central-panel-a')).toBeNull();
        expect(panel('b')).toBeInTheDocument();
        expect(onCloseA).toHaveBeenCalledTimes(1);
    });

    it('closing what is not there calls nothing', () => {
        area();
        fireEvent.click(screen.getByTestId('close-missing'));

        expect(onCloseA).not.toHaveBeenCalled();
        expect(onCloseB).not.toHaveBeenCalled();
        expect(screen.queryByTestId('central-stack')).toBeNull();
    });

    it('pushing the same id twice is pushing once, with the latest content on top', () => {
        area();
        fireEvent.click(screen.getByTestId('push-a'));
        fireEvent.click(screen.getByTestId('push-b'));
        fireEvent.click(screen.getByTestId('push-a'));

        // One A, and it is the one on top: closing it is back on B, not on another A.
        expect(screen.getAllByTestId('central-panel-a')).toHaveLength(1);
        expect(panel('a')).not.toHaveAttribute('hidden');
        fireEvent.click(screen.getByTestId('central-panel-a-close'));
        expect(panel('b')).not.toHaveAttribute('hidden');
    });
});

describe('CentralStack — back to the previous one', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('hides the panels below the top, and shows them again as it unwinds', () => {
        area();
        fireEvent.click(screen.getByTestId('push-a'));
        fireEvent.click(screen.getByTestId('push-b'));

        expect(panel('a')).toHaveAttribute('hidden');
        expect(panel('a')).toHaveAttribute('aria-hidden', 'true');
        expect(panel('b')).not.toHaveAttribute('hidden');
        expect(panel('b')).not.toHaveAttribute('aria-hidden');

        fireEvent.click(screen.getByTestId('central-panel-b-close'));

        expect(panel('a')).not.toHaveAttribute('hidden');
        expect(screen.queryByTestId('central-panel-b')).toBeNull();
    });

    it('keeps what a buried panel held', () => {
        area();
        fireEvent.click(screen.getByTestId('push-a'));
        fireEvent.change(screen.getByTestId('draft'), { target: { value: 'half a sentence' } });
        fireEvent.click(screen.getByTestId('push-b'));
        fireEvent.click(screen.getByTestId('central-panel-b-close'));

        expect(screen.getByTestId('draft')).toHaveValue('half a sentence');
    });

    it('says Cancel on the cross where the panel asks for it', () => {
        area();
        fireEvent.click(screen.getByTestId('push-b'));
        expect(screen.getByTestId('central-panel-b-close')).toHaveAccessibleName('Cancel');
    });
});

describe('CentralStack — the chrome around it', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('leaves the chrome usable while a panel is open', () => {
        area();
        fireEvent.click(screen.getByTestId('push-a'));

        // No mask over it, nothing trapped: the button beside the area answers as ever.
        fireEvent.click(screen.getByTestId('outside'));
        expect(outside).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('central-stack')?.querySelector('.ant-modal-mask')).toBeNull();
    });

    it('names an untitled panel for the reader that cannot see it', () => {
        const Bare: React.FC = () => {
            const { push } = useCentralStack();
            return <button data-testid="push-bare" onClick={() => push({ id: 'bare', label: 'Flow node editor', content: 'bare' })}>Bare</button>;
        };
        render(
            <CentralStackProvider>
                <Bare />
                <CentralStackView />
            </CentralStackProvider>,
        );
        fireEvent.click(screen.getByTestId('push-bare'));

        expect(panel('bare')).toHaveAttribute('aria-label', 'Flow node editor');
        expect(panel('bare').querySelector('.cms-stack-header')).toBeNull();
    });

    it('throws outside the layout rather than pushing nowhere', () => {
        const Nowhere: React.FC = () => {
            useCentralStack();
            return null;
        };
        expect(() => render(<Nowhere />)).toThrow('useCentralStack must be used within a CentralStackProvider');
    });
});
