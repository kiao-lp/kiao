import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { useWheelZoom } from './surfaceZoom';

type ZoomSurfaceProps = React.ComponentPropsWithoutRef<'div'> & {
    zoom: number;
    /** Enables Ctrl/Cmd+wheel on this surface. */
    onZoomChange?: (zoom: number) => void;
    /** Logical dimensions for content positioned outside normal flow. */
    contentSize?: { width: number; height: number };
    contentClassName?: string;
    /** Screen-sized controls or overlays in the outer surface's coordinate space. */
    overlay?: React.ReactNode;
};

export const ZoomSurface = forwardRef<HTMLDivElement, ZoomSurfaceProps>(({
    zoom, onZoomChange, contentSize, contentClassName, children, overlay, ...props
}, ref) => {
    const surface = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => surface.current!, []);
    useWheelZoom(surface, zoom, onZoomChange);

    return (
        <div {...props} ref={surface}>
            <div className={contentClassName} style={{ position: 'relative', ...contentSize, zoom }}>
                {children}
            </div>
            {overlay}
        </div>
    );
});

ZoomSurface.displayName = 'ZoomSurface';
