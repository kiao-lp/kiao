import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CardSurface } from './CardSurface';

it('toggles selection only once when the activation key is held', () => {
    const open = vi.fn();
    const toggle = vi.fn();
    render(<CardSurface selected={false} menuItems={[]} onOpen={open} onToggleSelection={toggle}>Card</CardSurface>);
    const card = screen.getByRole('button', { name: 'Card' });

    fireEvent.keyDown(card, { key: ' ', metaKey: true });
    expect(fireEvent.keyDown(card, { key: ' ', metaKey: true, repeat: true })).toBe(false);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
});

it('leaves activation, board shortcuts and drag starts to the control under the pointer or focus', () => {
    const open = vi.fn();
    const toggle = vi.fn();
    const keyDown = vi.fn();
    const pointerDown = vi.fn();
    render(
        <CardSurface selected menuItems={[]} onOpen={open} onToggleSelection={toggle}
            onKeyDown={keyDown} onPointerDown={pointerDown}>
            <span>Title</span>
            <button type="button"><span>Action</span></button>
            <span data-card-control><span>Connector</span></span>
        </CardSurface>,
    );

    for (const label of ['Action', 'Connector']) {
        const control = screen.getByText(label);
        fireEvent.pointerDown(control);
        fireEvent.click(control);
        fireEvent.click(control, { ctrlKey: true });
        expect(fireEvent.keyDown(control, { key: 'Enter' })).toBe(true);
        fireEvent.keyDown(control, { key: 'Delete' });
    }
    expect(open).not.toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();
    expect(keyDown).not.toHaveBeenCalled();
    expect(pointerDown).not.toHaveBeenCalled();

    const title = screen.getByText('Title');
    fireEvent.pointerDown(title);
    fireEvent.click(title);
    fireEvent.click(title, { ctrlKey: true });
    fireEvent.keyDown(title.parentElement!, { key: 'Delete' });
    expect(pointerDown).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(keyDown).toHaveBeenCalledTimes(1);
});
