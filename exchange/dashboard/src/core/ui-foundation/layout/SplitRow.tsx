import React, { useRef, useState } from 'react';
import classnames from 'classnames';
import { DEFAULT_PART_WEIGHT, DraggedPair, PartWeights, weightOf, weightsAfterDrag } from './splitModel';
import './ResizeHandle.css';
import './SplitRow.css';

/** Caller box props; the row owns only width. */
export type SplitPartBox = React.ComponentPropsWithRef<'div'> & {
    [attribute: `data-${string}`]: string | undefined;
};

export type SplitPart = SplitPartBox & {
    /** Stable part name, React key and weight-map key. */
    name: string;
    /** Hidden but mounted; yields width and has no handle. */
    collapsed?: boolean;
};

export interface SplitRowProps {
    id?: string;
    weights?: PartWeights;
    onWeightsChange?: React.Dispatch<React.SetStateAction<PartWeights>>;
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

/** Nearest visible part beside a handle, skipping collapsed parts. */
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

/** Draggable row parts with local or caller-controlled weights. */
export const SplitRow: React.FC<SplitRowProps> = ({ id, className, style, parts, weights: controlledWeights, onWeightsChange }) => {
    const [localWeights, setLocalWeights] = useState<PartWeights>({});
    const weights = controlledWeights ?? localWeights;
    const setWeights: React.Dispatch<React.SetStateAction<PartWeights>> = next => {
        if (controlledWeights === undefined) setLocalWeights(next);
        onWeightsChange?.(next);
    };
    // Held in a ref because the moves that read it are not renders: only the weights are state.
    const held = useRef<HeldHandle | null>(null);

    const startDrag = (before: string, after: string) => (event: React.PointerEvent<HTMLDivElement>) => {
        const handle = event.currentTarget;
        const beforeBox = partBeside(handle, 'previousElementSibling');
        const afterBox = partBeside(handle, 'nextElementSibling');
        if (!beforeBox || !afterBox) return;
        // Without it the drag selects the text it passes over instead of moving the handle.
        event.preventDefault();
        // Capture keeps the drag on the strip; jsdom has no capture.
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

    // Visible shares rescale to average one so the row always fills.
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

    return <div id={id} className={classnames('cms-split-row', className)} style={style}>{boxes}</div>;
};
