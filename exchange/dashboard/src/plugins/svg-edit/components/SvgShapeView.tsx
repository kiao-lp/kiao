import React, { useEffect, useRef, WheelEvent } from 'react';
import { bboxOfShape, Box, fmt, grownShape, isResizable, numAttr, SvgShape } from '../model';
import { useSvgStateContext } from '../state';

/**
 * An XML attribute name as React wants it: `stroke-width` → `strokeWidth`,
 * `xlink:href` → `xlinkHref`, `class` → `className`. `data-*` and `aria-*` pass through.
 */
export const reactPropName = (name: string): string => {
    if (name === 'class') return 'className';
    if (name.startsWith('data-') || name.startsWith('aria-')) return name;
    return name.replace(/[:\-_]([a-zA-Z])/g, (_, c: string) => c.toUpperCase());
};

/**
 * An inline `style` attribute as React wants it: parsed into an object, with
 * hyphenated names camel-cased (`stroke-width` → `strokeWidth`) and custom
 * properties (`--k-bg`) kept verbatim. React throws on a string style, so the
 * attribute never travels with the rest — read it through this instead.
 */
export const styleObjectOf = (style: string): React.CSSProperties => {
    const out: Record<string, string> = {};
    for (const declaration of style.split(';')) {
        const at = declaration.indexOf(':');
        if (at === -1) continue;
        const name = declaration.slice(0, at).trim();
        const value = declaration.slice(at + 1).trim();
        if (!name || !value) continue;
        out[name.startsWith('--') ? name : reactPropName(name)] = value;
    }
    return out;
};

export const reactPropsOf = (attrs: Record<string, string>): Record<string, string> => {
    const props: Record<string, string> = {};
    for (const [name, value] of Object.entries(attrs)) {
        if (name === 'style') continue;
        props[reactPropName(name)] = value;
    }
    return props;
};

interface SvgShapeViewProps {
    shape: SvgShape;
    onShapeDown: (event: React.PointerEvent, id: string) => void;
    onEditText: (id: string) => void;
}

/**
 * One shape on the canvas: drawn from its attributes, measured where the attributes say
 * nothing (text, path, g), and handed to the viewport's gestures. Selection is not drawn
 * here — the viewport rings what is selected with an overlay, so the drawing itself is
 * always exactly the file.
 */
export const SvgShapeView: React.FC<SvgShapeViewProps> = React.memo(({ shape, onShapeDown, onEditText }) => {
    const { patchShape, saveSvg, reportMeasured } = useSvgStateContext();
    const ref = useRef<SVGElement | null>(null);

    // What attributes cannot box — a text's font, a path's curve, a group's content — the
    // DOM measures. Reported up, where the box selection and the overlays read it.
    useEffect(() => {
        if (bboxOfShape(shape)) {
            reportMeasured(shape.id, null);
            return;
        }
        const element = ref.current as unknown as SVGGraphicsElement | null;
        if (!element || typeof element.getBBox !== 'function') return;
        try {
            const { x, y, width, height } = element.getBBox();
            if (width > 0 && height > 0) {
                reportMeasured(shape.id, { x, y, width, height } as Box);
            } else {
                reportMeasured(shape.id, null);
            }
        } catch {
            reportMeasured(shape.id, null);
        }
    });

    // The wheel resizes the shape about its centre — width, or height with Shift — the
    // mindmap note's own gesture. Over a text it grows the font instead, the text having
    // no box to grow.
    const onWheel = (event: WheelEvent) => {
        // A zoom gesture is the viewport's, not the shape's.
        if (event.ctrlKey || event.metaKey) return;
        if (shape.tag === 'text') {
            event.stopPropagation();
            const step = -Math.round(event.deltaY / 10);
            if (step === 0) return;
            const size = Math.max(1, numAttr(shape.attrs, 'font-size', 16) + step);
            patchShape(shape.id, { attrs: { ...shape.attrs, 'font-size': fmt(size) } });
            saveSvg();
            return;
        }
        if (!isResizable(shape) || !bboxOfShape(shape)) return;
        event.stopPropagation();
        const step = -Math.round(event.deltaY / 10);
        if (step === 0) return;
        const grown = grownShape(shape, event.shiftKey ? 0 : step, event.shiftKey ? step : 0);
        if (grown) {
            patchShape(shape.id, { attrs: grown.attrs });
            saveSvg();
        }
    };

    const onDoubleClick = (event: React.MouseEvent) => {
        event.stopPropagation();
        if (shape.tag === 'text') onEditText(shape.id);
    };

    const props = {
        ...reactPropsOf(shape.attrs),
        'data-shape-id': shape.id,
        style: { ...styleObjectOf(shape.attrs.style ?? ''), cursor: 'move' },
        onPointerDown: (event: React.PointerEvent) => onShapeDown(event, shape.id),
        onDoubleClick,
        onWheel,
    };

    if (shape.tag === 'g') {
        return <g ref={ref as React.Ref<SVGGElement>} {...props}
            dangerouslySetInnerHTML={{ __html: shape.inner ?? '' }} />;
    }
    if (shape.tag === 'text') {
        return <text ref={ref as React.Ref<SVGTextElement>} {...props}>{shape.text ?? ''}</text>;
    }
    return React.createElement(shape.tag, { ...props, ref });
});
