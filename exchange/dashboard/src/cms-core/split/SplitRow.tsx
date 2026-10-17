import React, { useRef } from 'react';
import classnames from 'classnames';
import { useGlobalViewState } from '../view-state';
import { DEFAULT_PART_WEIGHT, DraggedPair, PartWeights, weightOf, weightsAfterDrag } from './splitModel';
import '../ui/ResizeHandle.css';
import './SplitRow.css';

/**
 * Everything the caller wants on a part's own box, as it would put it on any `div` — a class, a
 * style, a `ref`, an `onScroll`, a `data-` attribute. The row owns only how wide the box is.
 */
export type SplitPartBox = React.ComponentPropsWithRef<'div'> & {
    [attribute: `data-${string}`]: string | undefined;
};

export type SplitPart = SplitPartBox & {
    /** Stable name — the React key, and what this part's share of the row is remembered under. */
    name: string;
    /**
     * This part has nothing to show and gives its width to the others. It stays mounted (what it
     * holds may still be saving) and takes no handle: there is nothing to drag it back from.
     */
    collapsed?: boolean;
};

export interface SplitRowProps {
    /** Names the row the shares are remembered under, app-wide. */
    id: string;
    className?: string;
    style?: React.CSSProperties;
    /** The parts, left to right. A handle is drawn between each two of them. */
    parts: SplitPart[];
}

/** The sides of a box its weight never bought — see `DraggedPair`. */
const INSETS = ['padding-left', 'padding-right', 'border-left-width', 'border-right-width'];

const extraOf = (box: HTMLElement): number => {
    const style = getComputedStyle(box);
    return INSETS.reduce((total, side) => total + (parseFloat(style.getPropertyValue(side)) || 0), 0);
};

/**
 * The part on one side of a handle, skipping any that have given their width up. A handle is only
 * ever drawn between two parts that are showing, but a collapsed one may sit between them.
 */
const partBeside = (
    handle: HTMLElement,
    towards: 'previousElementSibling' | 'nextElementSibling',
): HTMLElement | null => {
    let sibling = handle[towards];
    while (sibling instanceof HTMLElement) {
        if (!sibling.classList.contains('cms-split-part-collapsed')) return sibling;
        sibling = sibling[towards];
    }
    return null;
};

/** A handle being held: which two parts it moves width between, and how they stood when grabbed. */
interface HeldHandle {
    pointerId: number;
    startX: number;
    before: string;
    after: string;
    pair: DraggedPair;
}

/**
 * A row of the central area, divided into parts the reader drags the width of — the markdown
 * source beside its preview, a document beside the side documents shown with it.
 *
 * The same gesture as the columns around the document (`tool-bars/ToolBar-cmp`): a thin strip
 * between two parts, grabbed and moved. What is stored differs — a column is a width in pixels,
 * a part is a *share* of the row (see `splitModel`) — because a column is furniture of the window
 * whereas the parts divide whatever room the document has been left with.
 *
 * The shares are remembered app-wide rather than per document, like the columns' widths: how the
 * centre is divided describes the screen being worked on, not the file open on it.
 */
export const SplitRow: React.FC<SplitRowProps> = ({ id, className, style, parts }) => {
    const [weights, setWeights] = useGlobalViewState<PartWeights>(`split:${id}`, {});
    // Held in a ref because the moves that read it are not renders: only the weights are state.
    const held = useRef<HeldHandle | null>(null);

    const startDrag = (before: string, after: string) => (event: React.PointerEvent<HTMLDivElement>) => {
        const handle = event.currentTarget;
        const beforeBox = partBeside(handle, 'previousElementSibling');
        const afterBox = partBeside(handle, 'nextElementSibling');
        if (!beforeBox || !afterBox) return;
        // Without it the drag selects the text it passes over instead of moving the handle.
        event.preventDefault();
        // Captured on the strip, so a pointer that wanders off a few pixels of width — which a
        // finger does at once — goes on dragging until it is let go. Defensive: jsdom has no capture.
        handle.setPointerCapture?.(event.pointerId);

        held.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            before,
            after,
            // Read once: the pair's own width is what the drag shares out, and it does not change
            // while the handle is held.
            pair: {
                beforeSize: beforeBox.getBoundingClientRect().width,
                afterSize: afterBox.getBoundingClientRect().width,
                beforeExtra: extraOf(beforeBox),
                afterExtra: extraOf(afterBox),
                beforeWeight: weightOf(weights, before),
                afterWeight: weightOf(weights, after),
            },
        };
    };

    const onDrag = (event: React.PointerEvent<HTMLDivElement>) => {
        const handle = held.current;
        // A second finger put down elsewhere on the screen is not this drag.
        if (!handle || handle.pointerId !== event.pointerId) return;
        const next = weightsAfterDrag(handle.pair, event.clientX - handle.startX);
        setWeights(prev => ({ ...prev, [handle.before]: next.before, [handle.after]: next.after }));
    };

    const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
        if (held.current?.pointerId !== event.pointerId) return;
        held.current = null;
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    // A weight is a share of the pair its handle divided, not of the row: a pane dragged below
    // half keeps a weight below one, and grown flex items only fill the row past a total of one —
    // a preview left alone at 0.8 takes four fifths of the row and leaves an empty margin on the
    // right. The grows handed out are the visible shares rescaled to average one, so the row always
    // fills and the dragged proportions survive whatever is hidden and shown again.
    const shown = parts.filter(p => !p.collapsed);
    const shownTotal = shown.reduce((sum, p) => sum + weightOf(weights, p.name), 0);
    const growOf = (name: string): number => {
        if (shownTotal <= 0) return DEFAULT_PART_WEIGHT;
        return Math.round((weightOf(weights, name) * shown.length) / shownTotal * 1000) / 1000;
    };

    const boxes: React.ReactNode[] = [];
    /** The last part a handle could pull width from — none until one is actually showing. */
    let previous: string | null = null;

    for (const part of parts) {
        const { name, collapsed, className: partClassName, style: partStyle, ...box } = part;
        if (!collapsed && previous) {
            boxes.push(
                <div
                    key={`handle-${name}`}
                    className="cms-resize-handle cms-split-handle"
                    role="separator"
                    aria-orientation="vertical"
                    onPointerDown={startDrag(previous, name)}
                    onPointerMove={onDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    data-testid={`split-resize-${name}`}
                />,
            );
        }
        boxes.push(
            <div
                key={name}
                {...box}
                className={classnames('cms-split-part', partClassName, {
                    'cms-split-part-collapsed': collapsed,
                })}
                style={collapsed ? partStyle : { ...partStyle, flexGrow: growOf(name) }}
                data-split-part={name}
            />,
        );
        if (!collapsed) previous = name;
    }

    return <div className={classnames('cms-split-row', className)} style={style}>{boxes}</div>;
};
