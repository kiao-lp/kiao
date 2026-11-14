import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { magnify, type Magnified } from './magnify';
import './zoom.css';

/** What the reader may magnify: an element that asked for it, or any fenced markdown block. */
export const ZOOMABLE_SELECTOR = '[data-zoomable], .code-block-wrapper';

/** Spread onto an element to make it a zoom target — `<div {...zoomable}>`. */
export const zoomable = { 'data-zoomable': '' } as const;

/** Set on the target while it is selected, whether or not it is magnified. */
export const SELECTED_ATTR = 'data-cms-zoom-selected';

/** Minimum factor; 1 is unmagnified. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 2;
export const ZOOM_STEP = 0.05;

/** Factor applied on selection; >1 gives visible feedback. */
export const INITIAL_ZOOM = 1.25;

/** Long-press duration; matches the file browser and platform convention. */
export const LONG_PRESS_MS = 500;

/** Movement beyond this cancels a long-press (scroll intent). */
export const LONG_PRESS_TOLERANCE_PX = 10;

/** Nearest zoomable ancestor, or null. Links are never zoomable. */
const zoomableAt = (target: EventTarget | null): HTMLElement | null => {
    const from = target instanceof Element ? target : null;
    if (!from || from.closest('a[href]')) return null;
    return from.closest(ZOOMABLE_SELECTOR) as HTMLElement | null;
};

/** Editable elements; long-press stays with the editor. */
const EDITING_SELECTOR = 'input, textarea, [contenteditable]:not([contenteditable="false"])';

interface ZoomTargetContextType {
    /** The selected element, or null when nothing is selected. */
    element: HTMLElement | null;
    /** How much it is magnified, 1 being its own size. */
    factor: number;
    setFactor: (factor: number) => void;
    /** Selects an element, or deselects it when it is already the selected one. */
    select: (element: HTMLElement | null) => void;
    clear: () => void;
}

const ZoomTargetContext = createContext<ZoomTargetContextType | null>(null);

export const useZoomTarget = (): ZoomTargetContextType => {
    const context = useContext(ZoomTargetContext);
    if (!context) {
        throw new Error('useZoomTarget must be used within a ZoomTargetProvider');
    }
    return context;
};

/** For components that render with or without the provider — the banner is one. */
export const useZoomTargetOptional = (): ZoomTargetContextType | null => useContext(ZoomTargetContext);

const clampFactor = (factor: number) => Math.min(Math.max(factor, MIN_ZOOM), MAX_ZOOM);

/** Invariant: no selection implies factor 1. */
const NOTHING = { element: null, factor: 1 };

export const ZoomTargetProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Single state: selection and factor change together and must not drift.
    const [{ element, factor }, setState] = useState<{ element: HTMLElement | null; factor: number }>(NOTHING);
    const magnifiedRef = useRef<Magnified | null>(null);
    const factorRef = useRef(factor);
    factorRef.current = factor;
    const floating = factor !== 1;

    const clear = useCallback(() => setState(NOTHING), []);

    const select = useCallback((next: HTMLElement | null) => setState(
        current => (current.element === next ? NOTHING : { element: next, factor: INITIAL_ZOOM }),
    ), []);

    const setFactor = useCallback((next: number) => setState(
        current => ({ ...current, factor: clampFactor(next) }),
    ), []);

    // Ctrl/Cmd-click selects the nearest zoomable; links and non-zoomable targets pass through.
    useEffect(() => {
        const onClick = (event: MouseEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
            const found = zoomableAt(event.target);
            if (found) select(found);
        };
        document.addEventListener('click', onClick);
        return () => document.removeEventListener('click', onClick);
    }, [select]);

    // Non-mouse long-press selects after LONG_PRESS_MS; second press deselects.
    useEffect(() => {
        let timer = 0;
        let from: { x: number; y: number } | null = null;
        // True while the synthetic tap after a long-press must be swallowed.
        let taken = false;

        const forget = () => {
            if (timer) window.clearTimeout(timer);
            timer = 0;
            from = null;
        };

        const onPointerDown = (event: PointerEvent) => {
            // Any new pointer down cancels a pending press.
            forget();
            taken = false;
            if (event.pointerType === 'mouse') return;
            const found = zoomableAt(event.target);
            if (!found || (event.target as Element | null)?.closest?.(EDITING_SELECTOR)) return;
            from = { x: event.clientX, y: event.clientY };
            timer = window.setTimeout(() => {
                timer = 0;
                from = null;
                taken = true;
                window.getSelection()?.removeAllRanges();
                select(found);
            }, LONG_PRESS_MS);
        };

        const onPointerMove = (event: PointerEvent) => {
            if (!from) return;
            if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > LONG_PRESS_TOLERANCE_PX) forget();
        };

        // Suppress the platform callout only while a zoom long-press is pending or taken.
        const onContextMenu = (event: MouseEvent) => {
            if (from || taken) event.preventDefault();
        };

        const swallowTap = (event: MouseEvent) => {
            if (!taken) return;
            taken = false;
            event.preventDefault();
            event.stopPropagation();
        };

        // Capture phase: intercept before inner handlers consume the press or tap.
        const options = { capture: true } as const;
        document.addEventListener('pointerdown', onPointerDown, options);
        document.addEventListener('pointermove', onPointerMove, options);
        document.addEventListener('pointerup', forget, options);
        document.addEventListener('pointercancel', forget, options);
        document.addEventListener('contextmenu', onContextMenu, options);
        document.addEventListener('click', swallowTap, options);
        return () => {
            forget();
            document.removeEventListener('pointerdown', onPointerDown, options);
            document.removeEventListener('pointermove', onPointerMove, options);
            document.removeEventListener('pointerup', forget, options);
            document.removeEventListener('pointercancel', forget, options);
            document.removeEventListener('contextmenu', onContextMenu, options);
            document.removeEventListener('click', swallowTap, options);
        };
    }, [select]);

    // Escape clears selection without consuming the event; dialogs still close.
    useEffect(() => {
        if (!element) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') clear();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [element, clear]);

    // Attribute marker survives React renders; className would be overwritten. Clears on disconnect.
    useEffect(() => {
        if (!element) return;
        element.setAttribute(SELECTED_ATTR, '');
        const parent = element.parentNode;
        const observer = new MutationObserver(() => {
            if (!element.isConnected) clear();
        });
        if (parent) observer.observe(parent, { childList: true });
        return () => {
            observer.disconnect();
            element.removeAttribute(SELECTED_ATTR);
        };
    }, [element, clear]);

    // At factor 1 the element stays in flow untouched.
    useEffect(() => {
        if (!element || !floating) return;
        const magnified = magnify(element, factorRef.current);
        magnifiedRef.current = magnified;

        let frame = 0;
        const schedule = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                magnified.reposition();
            });
        };
        // Capture scroll from any ancestor; the element's own scroll does not reposition it.
        const onScroll = (event: Event) => {
            if (event.target !== element) schedule();
        };
        window.addEventListener('scroll', onScroll, { capture: true, passive: true });
        window.addEventListener('resize', schedule);
        const observer = new ResizeObserver(schedule);
        observer.observe(element);
        if (element.parentElement) observer.observe(element.parentElement);

        return () => {
            if (frame) cancelAnimationFrame(frame);
            observer.disconnect();
            window.removeEventListener('scroll', onScroll, { capture: true });
            window.removeEventListener('resize', schedule);
            magnified.release();
            magnifiedRef.current = null;
        };
    }, [element, floating]);

    useEffect(() => {
        magnifiedRef.current?.setFactor(factor);
    }, [factor]);

    const value = useMemo(
        () => ({ element, factor, setFactor, select, clear }),
        [element, factor, setFactor, select, clear],
    );

    return <ZoomTargetContext.Provider value={value}>{children}</ZoomTargetContext.Provider>;
};
