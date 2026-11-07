import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReorderHandle } from './ReorderHandle';
import { useReorderable } from './useReorderable';

const ROW_HEIGHT = 20;

/**
 * jsdom has no `PointerEvent`, and Testing Library's fallback `Event` drops `clientY` — the one
 * thing a drag is made of. A `MouseEvent` named after the pointer event carries it, and React
 * dispatches on the name, so the component sees exactly what a browser would send it.
 */
const pointer = (type: string, target: Element, clientY: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    fireEvent(target, event);
};

const List: React.FC<{ items: string[]; onMove: (from: number, to: number) => void }> = (
    { items, onMove },
) => {
    const reorder = useReorderable({ count: items.length, onMove });
    return (
        <ul>
            {items.map((item, i) => (
                <li key={item} {...reorder.rowProps(i, 'row')} data-testid={`row-${item}`}>
                    <ReorderHandle {...reorder.handleProps(i)} label={`Reorder ${item}`} />
                    {item}
                </li>
            ))}
        </ul>
    );
};

/** jsdom lays nothing out, so the rows are given the geometry the drag reads. */
const stackRows = (items: string[]) => {
    items.forEach((item, i) => {
        const top = i * ROW_HEIGHT;
        screen.getByTestId(`row-${item}`).getBoundingClientRect = () =>
            ({ top, bottom: top + ROW_HEIGHT, height: ROW_HEIGHT }) as DOMRect;
    });
};

const grip = (item: string) => screen.getByLabelText(`Reorder ${item}`);

const drag = (item: string, toY: number) => {
    const handle = grip(item);
    pointer('pointerdown', handle, 0);
    pointer('pointermove', handle, toY);
    pointer('pointerup', handle, toY);
};

describe('useReorderable — dragging', () => {
    it('drops the row in the gap the pointer stopped in', () => {
        const onMove = vi.fn();
        render(<List items={['a', 'b', 'c', 'd']} onMove={onMove} />);
        stackRows(['a', 'b', 'c', 'd']);

        // Past the middle of `c` (y = 50), so the row lands between `c` and `d`.
        drag('a', 55);

        expect(onMove).toHaveBeenCalledWith(0, 2);
    });

    it('moves a row up when the pointer travels above it', () => {
        const onMove = vi.fn();
        render(<List items={['a', 'b', 'c', 'd']} onMove={onMove} />);
        stackRows(['a', 'b', 'c', 'd']);

        drag('d', 5);

        expect(onMove).toHaveBeenCalledWith(3, 0);
    });

    // A press that goes nowhere is a click on the grip, and a click on the grip does nothing.
    it('commits nothing when the row is dropped where it started', () => {
        const onMove = vi.fn();
        render(<List items={['a', 'b', 'c']} onMove={onMove} />);
        stackRows(['a', 'b', 'c']);

        drag('b', 25);

        expect(onMove).not.toHaveBeenCalled();
    });

    it('marks the dragged row and the gap it is aimed at', () => {
        render(<List items={['a', 'b', 'c']} onMove={vi.fn()} />);
        stackRows(['a', 'b', 'c']);

        const handle = grip('a');
        pointer('pointerdown', handle, 0);
        pointer('pointermove', handle, 45);

        expect(screen.getByTestId('row-a')).toHaveClass('kiao-reorder-row-dragging');
        expect(screen.getByTestId('row-c')).toHaveClass('kiao-reorder-drop-before');
        // The list itself has not moved: nothing slides out from under the pointer mid-drag.
        expect(screen.getByTestId('row-a').textContent).toContain('a');

        pointer('pointerup', handle, 45);
        expect(screen.getByTestId('row-a')).not.toHaveClass('kiao-reorder-row-dragging');
    });

    it('abandons the drag on Escape, leaving the list untouched', () => {
        const onMove = vi.fn();
        render(<List items={['a', 'b', 'c']} onMove={onMove} />);
        stackRows(['a', 'b', 'c']);

        const handle = grip('a');
        pointer('pointerdown', handle, 0);
        pointer('pointermove', handle, 55);
        fireEvent.keyDown(window, { key: 'Escape' });
        pointer('pointerup', handle, 55);

        expect(onMove).not.toHaveBeenCalled();
        expect(screen.getByTestId('row-a')).not.toHaveClass('kiao-reorder-row-dragging');
    });
});

describe('useReorderable — keyboard', () => {
    it('moves a row one place with the arrows', () => {
        const onMove = vi.fn();
        render(<List items={['a', 'b', 'c']} onMove={onMove} />);

        fireEvent.keyDown(grip('b'), { key: 'ArrowUp' });
        expect(onMove).toHaveBeenLastCalledWith(1, 0);

        fireEvent.keyDown(grip('b'), { key: 'ArrowDown' });
        expect(onMove).toHaveBeenLastCalledWith(1, 2);
    });

    it('sends a row to either end with Home and End', () => {
        const onMove = vi.fn();
        render(<List items={['a', 'b', 'c']} onMove={onMove} />);

        fireEvent.keyDown(grip('c'), { key: 'Home' });
        expect(onMove).toHaveBeenLastCalledWith(2, 0);

        fireEvent.keyDown(grip('a'), { key: 'End' });
        expect(onMove).toHaveBeenLastCalledWith(0, 2);
    });

    it('stops at the ends of the list', () => {
        const onMove = vi.fn();
        render(<List items={['a', 'b']} onMove={onMove} />);

        fireEvent.keyDown(grip('a'), { key: 'ArrowUp' });
        fireEvent.keyDown(grip('b'), { key: 'ArrowDown' });

        expect(onMove).not.toHaveBeenCalled();
    });
});

// A list of one has no order to edit; the grip says so rather than pretending otherwise.
describe('useReorderable — a single row', () => {
    it('disables the grip', () => {
        render(<List items={['a']} onMove={vi.fn()} />);
        expect(grip('a')).toBeDisabled();
    });
});
