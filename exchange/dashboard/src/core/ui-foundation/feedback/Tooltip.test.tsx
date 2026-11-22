import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { GetRef, TooltipProps } from 'antd';
import { Tooltip } from './Tooltip';

/**
 * Two things this wrapper exists for, neither of which shows in a rendered tree.
 *
 * The **viewport rule** is a prop handed to Ant Design's popup engine, and what it does — sliding a
 * tooltip back inside the window — needs a real layout to observe; that is asserted end to end in
 * `e2e/tests/dashboard/viewport-bounds.spec.ts`. What is worth pinning here is that the rule is
 * asked for at all, since a wrapper that forgot it would still render, still pass every other test,
 * and quietly put every tooltip in the app back where it was.
 *
 * The **ref** matters because a tooltip is so often the middle of a sandwich — a Dropdown around a
 * Tooltip around a button. The outer popup aims at its child through a ref, and a wrapper that
 * swallowed it left the menu open but parked off-screen.
 */

const antdTooltipProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));

vi.mock('antd', async importOriginal => {
    const actual = await importOriginal<typeof import('antd')>();
    const Spy = React.forwardRef<GetRef<typeof actual.Tooltip>, TooltipProps>((props, ref) => {
        antdTooltipProps.last = props as unknown as Record<string, unknown>;
        return <actual.Tooltip ref={ref} {...props} />;
    });
    return { ...actual, Tooltip: Spy };
});

describe('the app tooltip', () => {
    it('asks the popup engine to slide it back inside the window, on both axes', () => {
        render(<Tooltip title="anything"><button>trigger</button></Tooltip>);
        expect(antdTooltipProps.last?.autoAdjustOverflow).toMatchObject({ shiftX: true, shiftY: true });
    });

    it('lets a caller place a tooltip itself', () => {
        render(
            <Tooltip title="anything" autoAdjustOverflow={false}><button>trigger</button></Tooltip>,
        );
        expect(antdTooltipProps.last?.autoAdjustOverflow).toBe(false);
    });

    it('passes a ref through to the element it wraps, so an outer popup can aim at it', () => {
        const ref = React.createRef<GetRef<typeof Tooltip>>();
        render(<Tooltip title="anything" ref={ref}><button>trigger</button></Tooltip>);
        expect(ref.current?.nativeElement).toBe(screen.getByRole('button'));
    });
});

/**
 * The **stillness rule**: the popup opens only once the pointer has rested on its target for
 * 600ms, and every move restarts the countdown. Ant Design's own `mouseEnterDelay` is a single
 * fuse lit on entry — moving inside the target does not relight it — so these tests pin the
 * difference: a rest opens, a move within the 600ms postpones, a leave cancels.
 */
describe('the app tooltip opens after a still 600ms', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    /** The laid-out popup, or nothing when no tooltip is open. */
    const openTip = () => document.querySelector('.ant-tooltip:not(.ant-tooltip-hidden)');

    const hover = (text: string) => {
        render(<Tooltip title="the explanation"><button>{text}</button></Tooltip>);
        fireEvent.mouseOver(screen.getByRole('button', { name: text }));
    };

    it('stays shut while the pointer passes over, and opens once it has rested 600ms', () => {
        hover('target');

        act(() => { vi.advanceTimersByTime(599); });
        expect(openTip()).toBeNull();

        act(() => { vi.advanceTimersByTime(1); });
        expect(openTip()?.textContent).toContain('the explanation');
    });

    it('restarts the countdown on every move, so motion alone never opens it', () => {
        hover('target');

        act(() => { vi.advanceTimersByTime(500); });
        fireEvent.mouseMove(document);
        act(() => { vi.advanceTimersByTime(500); });
        expect(openTip()).toBeNull();

        act(() => { vi.advanceTimersByTime(100); });
        expect(openTip()?.textContent).toContain('the explanation');
    });

    it('cancels the countdown on leave', () => {
        hover('target');

        act(() => { vi.advanceTimersByTime(500); });
        fireEvent.mouseLeave(screen.getByRole('button', { name: 'target' }));
        act(() => { vi.advanceTimersByTime(2000); });
        expect(openTip()).toBeNull();
    });

    it('does not let a move after the leave resurrect the countdown', () => {
        hover('target');
        act(() => { vi.advanceTimersByTime(500); });

        // A sweep across neighbouring targets: the leave and the moves that follow it land in
        // the same tick, before React has taken the pending move listener down. Dispatched raw
        // rather than through fireEvent so nothing flushes in between.
        act(() => {
            screen.getByRole('button', { name: 'target' })
                .dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
            document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        });
        act(() => { vi.advanceTimersByTime(2000); });
        expect(openTip()).toBeNull();
    });

    it('does not re-arm on moves once the still second has elapsed', () => {
        const onOpenChange = vi.fn();
        render(<Tooltip title="the explanation" onOpenChange={onOpenChange}><button>target</button></Tooltip>);
        fireEvent.mouseOver(screen.getByRole('button', { name: 'target' }));
        act(() => { vi.advanceTimersByTime(599); });

        act(() => {
            vi.advanceTimersByTime(1);
            document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        });
        act(() => { vi.advanceTimersByTime(2000); });
        expect(openTip()?.textContent).toContain('the explanation');
        expect(onOpenChange).toHaveBeenCalledTimes(1);
    });

    it('closes an open tooltip on leave', () => {
        hover('target');
        act(() => { vi.advanceTimersByTime(600); });
        expect(openTip()).not.toBeNull();

        fireEvent.mouseLeave(screen.getByRole('button', { name: 'target' }));
        act(() => { vi.advanceTimersByTime(200); });
        expect(openTip()).toBeNull();
    });

    it('lets a caller in a hurry ask for a shorter stillness', () => {
        render(<Tooltip title="the explanation" mouseEnterDelay={0.2}><button>target</button></Tooltip>);
        fireEvent.mouseOver(screen.getByRole('button', { name: 'target' }));

        act(() => { vi.advanceTimersByTime(199); });
        expect(openTip()).toBeNull();

        act(() => { vi.advanceTimersByTime(1); });
        expect(openTip()?.textContent).toContain('the explanation');
    });

    it('opens at once when the caller passes no delay at all', () => {
        render(<Tooltip title="the explanation" mouseEnterDelay={0}><button>target</button></Tooltip>);
        fireEvent.mouseOver(screen.getByRole('button', { name: 'target' }));

        expect(openTip()?.textContent).toContain('the explanation');
    });

    it('leaves a caller-driven popup alone: open wins, hover and countdown included', () => {
        const { rerender } = render(
            <Tooltip title="the explanation" open={false}><button>target</button></Tooltip>);
        fireEvent.mouseOver(screen.getByRole('button', { name: 'target' }));
        act(() => { vi.advanceTimersByTime(2000); });
        expect(openTip()).toBeNull();

        rerender(<Tooltip title="the explanation" open={true}><button>target</button></Tooltip>);
        expect(openTip()?.textContent).toContain('the explanation');
    });

    it('reports the effective openings and closings, after the stillness has been served', () => {
        const onOpenChange = vi.fn();
        render(<Tooltip title="the explanation" onOpenChange={onOpenChange}><button>target</button></Tooltip>);
        fireEvent.mouseOver(screen.getByRole('button', { name: 'target' }));
        expect(onOpenChange).not.toHaveBeenCalled();

        act(() => { vi.advanceTimersByTime(1000); });
        expect(onOpenChange).toHaveBeenCalledTimes(1);
        expect(onOpenChange).toHaveBeenLastCalledWith(true);

        fireEvent.mouseLeave(screen.getByRole('button', { name: 'target' }));
        act(() => { vi.advanceTimersByTime(200); });
        expect(onOpenChange).toHaveBeenCalledTimes(2);
        expect(onOpenChange).toHaveBeenLastCalledWith(false);
    });
});

/**
 * The markdown follow-up's reservation: a `markdown` prop the tooltip accepts today and shows as
 * plain text, so the call sites are written once and the rendering lands later. What is pinned
 * here is the fallback — raw source, no rich text — which the follow-up replaces.
 */
describe('the app tooltip takes markdown as plain text until the follow-up', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const openTip = () => document.querySelector('.ant-tooltip:not(.ant-tooltip-hidden)');

    it('shows the markdown source as it stands', () => {
        render(<Tooltip markdown="**bold** words"><button>target</button></Tooltip>);
        fireEvent.mouseOver(screen.getByRole('button', { name: 'target' }));
        act(() => { vi.advanceTimersByTime(1000); });

        const tip = openTip();
        expect(tip?.textContent).toContain('**bold** words');
        expect(tip?.querySelector('strong')).toBeNull();
    });

    it('lets title win when both are given', () => {
        render(<Tooltip title="plain" markdown="**bold**"><button>target</button></Tooltip>);
        fireEvent.mouseOver(screen.getByRole('button', { name: 'target' }));
        act(() => { vi.advanceTimersByTime(1000); });

        expect(openTip()?.textContent).toContain('plain');
        expect(openTip()?.textContent).not.toContain('bold');
    });
});
