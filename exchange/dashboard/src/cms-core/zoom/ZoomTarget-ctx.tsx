// ── The magnifying glass, as a core service ───────────────────────────────────
//
// One element at a time in the whole app can be *the* zoom target. It is picked by Ctrl-clicking
// it — or, on a tablet where there is no Ctrl key to hold, by pressing it and keeping the finger
// down. It wears an outline while it is picked, and the slider the top banner grows for it
// magnifies it. Escape, or picking it a second time, puts it back.
//
// The interaction is delegated from the document rather than wired at each site: anything already
// on screen becomes zoomable by matching {@link ZOOMABLE_SELECTOR} — a `data-zoomable` marker of
// its own, or a fenced markdown block, which is how every rendered diagram is one without the
// markdown renderer knowing this exists. That is what makes it a core service rather than a chat
// feature: the next place that needs it marks an element and gets the banner control for free.
//
// **The nearest match wins**, which is what decides how small a target is. A reply marks each run
// of prose between two tool calls, not the whole turn, so Ctrl-clicking a paragraph magnifies the
// passage being read; Ctrl-clicking a diagram inside that passage magnifies the diagram, because
// the fenced block is nearer.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { magnify, type Magnified } from './magnify';

/** What the reader may magnify: an element that asked for it, or any fenced markdown block. */
export const ZOOMABLE_SELECTOR = '[data-zoomable], .code-block-wrapper';

/** Spread onto an element to make it a zoom target — `<div {...zoomable}>`. */
export const zoomable = { 'data-zoomable': '' } as const;

/** Set on the target while it is selected, whether or not it is magnified. */
export const SELECTED_ATTR = 'data-cms-zoom-selected';

/** Its own size is the floor: the magnifier makes things bigger, never smaller. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 2;
export const ZOOM_STEP = 0.05;

/**
 * Where a fresh selection starts.
 *
 * Not 1: Ctrl-clicking to read something and getting the same size back would say nothing
 * happened. It opens already larger, and the slider is there to take it further or to bring it back
 * down — 100% included, where the element simply returns to the flow.
 */
export const INITIAL_ZOOM = 1.25;

/**
 * How long a finger stays down before the press means "magnify this" rather than "tap this".
 *
 * The same half second the file browser gives its own long press, which is the one the platforms
 * use: a reader who has learned the gesture anywhere has learned it here.
 */
export const LONG_PRESS_MS = 500;

/** A press that wanders further than this was the beginning of a scroll, and never a press. */
export const LONG_PRESS_TOLERANCE_PX = 10;

/**
 * The nearest zoomable around what the pointer landed on, or null when there is none to take.
 *
 * A link is never one, whichever way it was reached: Ctrl-clicking a link is how it opens in a new
 * tab and holding it down is how a phone offers to, and it would be a poor trade to lose either to
 * the zoom.
 */
const zoomableAt = (target: EventTarget | null): HTMLElement | null => {
    const from = target instanceof Element ? target : null;
    if (!from || from.closest('a[href]')) return null;
    return from.closest(ZOOMABLE_SELECTOR) as HTMLElement | null;
};

/** Where a press is how the caret is placed and how a word is picked — see the long press below. */
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

/** Nothing selected reads as nothing magnified, which is the only state the two may be in apart. */
const NOTHING = { element: null, factor: 1 };

export const ZoomTargetProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // One piece of state, because a selection and the size it is read at are one thing: every
    // selection opens at {@link INITIAL_ZOOM} and every deselection drops back to 1, and holding
    // them apart is how they would drift out of step.
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

    // Ctrl-click — Cmd on a Mac — picks the nearest zoomable ancestor of what was clicked, and it
    // is the modifier rather than a second click because double-clicking is already how a word is
    // selected, how an editor opens, how a row is entered. A modified click landing nowhere near a
    // zoomable is left alone, and so is one on a link: Ctrl-clicking a link is how it opens in a
    // new tab, and it would be a poor trade to lose that to the zoom.
    useEffect(() => {
        const onClick = (event: MouseEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
            const found = zoomableAt(event.target);
            if (found) select(found);
        };
        document.addEventListener('click', onClick);
        return () => document.removeEventListener('click', onClick);
    }, [select]);

    // The same reach on a tablet or a phone: press a diagram or a reply and keep the finger down,
    // and it is picked at {@link LONG_PRESS_MS} — a second long press, like a second Ctrl-click,
    // puts it back. Delegated from the document like the click above, so an element is zoomable by
    // being marked and never by being wired.
    //
    // Everything but a mouse, rather than touch alone: holding a mouse button down is nothing and
    // must stay nothing, while a reader drawing on a tablet with a stylus has no more of a Ctrl key
    // than one using a finger.
    useEffect(() => {
        let timer = 0;
        let from: { x: number; y: number } | null = null;
        // True from the moment the press is taken until the tap it would have been is swallowed.
        // The browser sends that tap anyway, and letting it through would open the file, run the
        // button or follow whatever is under the finger on top of magnifying it.
        let taken = false;

        const forget = () => {
            if (timer) window.clearTimeout(timer);
            timer = 0;
            from = null;
        };

        const onPointerDown = (event: PointerEvent) => {
            // A second finger is a pinch or the start of a scroll, and ends whatever was pending.
            forget();
            taken = false;
            if (event.pointerType === 'mouse') return;
            const found = zoomableAt(event.target);
            // A press inside something being typed in is how the caret is put where it is wanted
            // and how a word there is picked; that gesture is the editor's and the zoom leaves it.
            if (!found || (event.target as Element | null)?.closest?.(EDITING_SELECTOR)) return;
            from = { x: event.clientX, y: event.clientY };
            timer = window.setTimeout(() => {
                timer = 0;
                from = null;
                taken = true;
                // The platform may have begun selecting the words under the finger on its way to
                // the press. What is being read now is the element, not a passage of it.
                window.getSelection()?.removeAllRanges();
                select(found);
            }, LONG_PRESS_MS);
        };

        const onPointerMove = (event: PointerEvent) => {
            if (!from) return;
            if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > LONG_PRESS_TOLERANCE_PX) forget();
        };

        // The callout the platform offers for a long press — copy, share, look up — belongs to the
        // gesture, and the gesture is the zoom's here. Only over a zoomable held by something that
        // is not a mouse, so the right click of one still opens every menu it ever did.
        const onContextMenu = (event: MouseEvent) => {
            if (from || taken) event.preventDefault();
        };

        const swallowTap = (event: MouseEvent) => {
            if (!taken) return;
            taken = false;
            event.preventDefault();
            event.stopPropagation();
        };

        // Captured, so a press is read before anything on the way to it can keep it to itself, and
        // so the tap is swallowed before it reaches what it would have run.
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

    // Escape gives the element back, wherever the focus is. It does not stop the event: a dialog
    // open over a magnified element must still close on the same key.
    useEffect(() => {
        if (!element) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') clear();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [element, clear]);

    // The outline, and the watch that drops a selection whose element has left the page — a
    // conversation switched while a message was magnified, say. The marker is an attribute rather
    // than a class because React owns `className` here and would wipe it on the next render.
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

    // Magnification proper. At its own size the element is left in the flow untouched — selecting
    // something must not move anything by itself.
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
        // Captured, so the scroll of any container on the way counts: the element follows the place
        // it came from rather than drifting away from it. Its own scrollbars are the exception —
        // reading down a passage too long for the window does not move the passage.
        const onScroll = (event: Event) => {
            if (event.target !== element) schedule();
        };
        window.addEventListener('scroll', onScroll, { capture: true, passive: true });
        window.addEventListener('resize', schedule);
        // The element's own box, and the flow it left: resizing the panel around it moves the space
        // it is anchored to without scrolling anything.
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
