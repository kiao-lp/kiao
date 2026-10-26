import { resizeInViewport, type Box, type ResizeEdge } from './zoomPlacement';

const EDGES: ResizeEdge[] = ['top', 'right', 'bottom', 'left', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];

/** Handles sit outside the scrollable box, in screen pixels regardless of the content's zoom. */
export const resizeHandles = (doc: Document, area: () => Box, resize: (box: Box) => void, margin: number) => {
    const frame = doc.createElement('div');
    frame.className = 'cms-zoom-resize-frame';
    frame.setAttribute('aria-hidden', 'true');
    let box: Box = { left: 0, top: 0, width: 0, height: 0 };
    let drag: { edge: ResizeEdge; box: Box; x: number; y: number; pointer: number; handle: HTMLElement } | null = null;

    const stop = () => {
        const previous = drag;
        drag = null;
        if (previous?.handle.hasPointerCapture?.(previous.pointer)) {
            previous.handle.releasePointerCapture(previous.pointer);
        }
    };

    for (const edge of EDGES) {
        const handle = doc.createElement('div');
        handle.setAttribute('data-cms-zoom-resize', edge);
        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0 || drag) return;
            event.preventDefault();
            event.stopPropagation();
            drag = { edge, box: { ...box }, x: event.clientX, y: event.clientY, pointer: event.pointerId, handle };
            handle.setPointerCapture?.(event.pointerId);
        });
        handle.addEventListener('pointermove', event => {
            if (!drag || event.pointerId !== drag.pointer) return;
            event.preventDefault();
            resize(resizeInViewport(drag.box, drag.edge, {
                left: event.clientX - drag.x,
                top: event.clientY - drag.y,
            }, area(), margin));
        });
        handle.addEventListener('pointerup', stop);
        handle.addEventListener('pointercancel', stop);
        handle.addEventListener('lostpointercapture', stop);
        frame.append(handle);
    }
    doc.body.append(frame);

    return {
        place: (next: Box) => {
            box = next;
            Object.assign(frame.style, {
                left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`,
            });
        },
        release: () => {
            stop();
            frame.remove();
        },
    };
};
