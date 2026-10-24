import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Tooltip as AntTooltip } from 'antd';
import type { GetRef, TooltipProps } from 'antd';

/**
 * Dashboard cannot scroll to off-screen popups. shiftX/shiftY=true fully shift the
 * popup into view after flipping; popups wider than the viewport still overflow.
 * Ant Design forwards these engine options but omits them from its types.
 */
const KEEP_IN_VIEWPORT = {
    adjustX: 1,
    adjustY: 1,
    shiftX: true,
    shiftY: true,
} as TooltipProps['autoAdjustOverflow'];

/** Pointer stillness required before opening, in seconds (mouseEnterDelay units). */
export const TOOLTIP_STILL_SECONDS = 0.6;

export interface AppTooltipProps extends TooltipProps {
    /** Shown as plain text; title takes precedence when both are supplied. */
    markdown?: string;
}

/**
 * Import from @cms-core for viewport adjustment and pointer-stillness timing.
 * Keep tooltip text under 30 words (decision 00053-tooltip-under-30-words.md).
 *
 * Unlike Ant Design's entry delay, movement restarts this countdown until opening.
 * Controlled open, non-hover triggers, and mouseEnterDelay=0 bypass stillness.
 * onOpenChange reports effective openings and closings after the delay.
 *
 * Wrap native disabled elements in a span: they emit no mouse events.
 * Forward the ref so an enclosing Dropdown can find its alignment anchor.
 */
export const Tooltip = React.forwardRef<GetRef<typeof AntTooltip>, AppTooltipProps>((props, ref) => {
    const {
        autoAdjustOverflow = KEEP_IN_VIEWPORT,
        mouseEnterDelay = TOOLTIP_STILL_SECONDS,
        markdown,
        title,
        open,
        onOpenChange,
        trigger,
        ...rest
    } = props;

    const resolvedTitle = title ?? markdown;

    const hoverTriggered = trigger === undefined
        || (Array.isArray(trigger) ? trigger.includes('hover') : trigger === 'hover');
    const stillness = open === undefined && hoverTriggered && (mouseEnterDelay ?? 0) > 0;

    const [stillOpen, setStillOpen] = useState(props.defaultOpen ?? false);
    const [pending, setPending] = useState(false);
    const innerRef = useRef<GetRef<typeof AntTooltip> | null>(null);
    const setRefs = useCallback((instance: GetRef<typeof AntTooltip> | null) => {
        innerRef.current = instance;
        if (typeof ref === 'function') ref(instance);
        else if (ref) (ref as React.MutableRefObject<GetRef<typeof AntTooltip> | null>).current = instance;
    }, [ref]);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Detach synchronously on leave/open: before effect cleanup, another mousemove could
    // re-arm the timer after the pointer has left, opening a tooltip with no way to close it.
    const restartRef = useRef<(() => void) | null>(null);
    const delayRef = useRef((mouseEnterDelay ?? 0) * 1000);
    delayRef.current = (mouseEnterDelay ?? 0) * 1000;
    const openChangeRef = useRef(onOpenChange);
    openChangeRef.current = onOpenChange;

    const clearTimer = useCallback(() => {
        if (timer.current !== null) {
            clearTimeout(timer.current);
            timer.current = null;
        }
    }, []);

    const detachRestart = useCallback(() => {
        if (restartRef.current !== null) {
            document.removeEventListener('mousemove', restartRef.current);
            restartRef.current = null;
        }
    }, []);

    const arm = useCallback(() => {
        clearTimer();
        timer.current = setTimeout(() => {
            timer.current = null;
            detachRestart();
            setPending(false);
            setStillOpen(true);
            openChangeRef.current?.(true);
        }, delayRef.current);
    }, [clearTimer, detachRestart]);

    useEffect(() => {
        if (!stillness || !pending) return;
        const restart = () => arm();
        restartRef.current = restart;
        document.addEventListener('mousemove', restart);
        return () => {
            document.removeEventListener('mousemove', restart);
            if (restartRef.current === restart) restartRef.current = null;
        };
    }, [stillness, pending, arm]);

    useEffect(() => clearTimer, [clearTimer]);

    const cancel = useCallback(() => {
        clearTimer();
        detachRestart();
        setPending(false);
        setStillOpen(was => {
            if (was) openChangeRef.current?.(false);
            return false;
        });
    }, [clearTimer, detachRestart]);

    const handleOpenChange = useCallback((next: boolean) => {
        if (next) {
            setPending(true);
            arm();
        } else {
            cancel();
        }
    }, [arm, cancel]);

    // Controlled Ant Design omits leaves while closed/pending, so listen natively.
    // Cancellation must be idempotent: an open tooltip also reports through onOpenChange.
    useEffect(() => {
        if (!stillness) return;
        const element = innerRef.current?.nativeElement;
        if (!element) return;
        element.addEventListener('mouseleave', cancel);
        element.addEventListener('blur', cancel);
        return () => {
            element.removeEventListener('mouseleave', cancel);
            element.removeEventListener('blur', cancel);
        };
    });

    if (!stillness) {
        return (
            <AntTooltip
                ref={setRefs}
                autoAdjustOverflow={autoAdjustOverflow}
                mouseEnterDelay={mouseEnterDelay}
                title={resolvedTitle}
                open={open}
                onOpenChange={onOpenChange}
                trigger={trigger}
                {...rest}
            />
        );
    }
    return (
        <AntTooltip
            ref={setRefs}
            autoAdjustOverflow={autoAdjustOverflow}
            mouseEnterDelay={0}
            title={resolvedTitle}
            open={stillOpen}
            onOpenChange={handleOpenChange}
            trigger={trigger}
            {...rest}
        />
    );
});

Tooltip.displayName = 'Tooltip';
