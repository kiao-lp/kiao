import React, { createRef } from 'react';
import { Dropdown } from 'antd';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TOOLTIP_STILL_SECONDS } from '../feedback/Tooltip';
import { IconButton } from './IconButton';

const icon = <svg aria-hidden="true" />;

const waitForTooltip = () => act(() => vi.advanceTimersByTime(TOOLTIP_STILL_SECONDS * 1000));

describe('IconButton', () => {
    it('shows contextual help on keyboard focus and keeps the button name stable', () => {
        vi.useFakeTimers();
        try {
            render(<IconButton label="Pin" tooltip="Keep the conversation beside the list" icon={icon} aria-pressed={false} />);
            const button = screen.getByRole('button', { name: 'Pin', pressed: false });
            act(() => button.focus());
            waitForTooltip();
            expect(screen.getByRole('tooltip')).toHaveTextContent('Keep the conversation beside the list');
            expect(button).toHaveAccessibleName('Pin');
            expect(button).toHaveAccessibleDescription('Keep the conversation beside the list');
            act(() => button.blur());
            expect(button).not.toHaveAttribute('aria-describedby');
        } finally {
            vi.useRealTimers();
        }
    });

    it('lets a disabled action explain itself without activating the button or its enclosing row', () => {
        vi.useFakeTimers();
        try {
            const onClick = vi.fn();
            const onRowClick = vi.fn();
            const action = (disabled: boolean) => <div onClick={onRowClick}>
                <IconButton label="Import" tooltip icon={icon} disabled={disabled} onClick={onClick} />
            </div>;
            const { rerender } = render(action(true));
            const button = screen.getByRole('button', { name: 'Import' });
            expect(button).toBeDisabled();
            const anchor = button.parentElement!;
            fireEvent.mouseEnter(anchor);
            waitForTooltip();
            expect(screen.getByRole('tooltip')).toHaveTextContent('Import');
            fireEvent.click(anchor);
            expect(onClick).not.toHaveBeenCalled();
            expect(onRowClick).not.toHaveBeenCalled();

            rerender(action(false));
            expect(screen.getByRole('button', { name: 'Import' })).toBe(button);
            expect(button).toBeEnabled();
            fireEvent.click(button);
            expect(onClick).toHaveBeenCalledOnce();
        } finally {
            vi.useRealTimers();
        }
    });

    it('forwards the button ref and the surrounding Dropdown trigger', async () => {
        const ref = createRef<HTMLButtonElement>();
        render(<Dropdown trigger={['click']} menu={{ items: [{ key: 'new', label: 'New board' }] }}>
            <IconButton ref={ref} label="Create board or folder" tooltip icon={icon} />
        </Dropdown>);
        const button = screen.getByRole('button', { name: 'Create board or folder' });
        expect(ref.current).toBe(button);
        fireEvent.click(button);
        expect(await screen.findByRole('menuitem', { name: 'New board' })).toBeVisible();
    });

    it('keeps plain actions out of form submission and shows help only when supplied', () => {
        const onSubmit = vi.fn(event => event.preventDefault());
        const onClick = vi.fn();
        render(<form onSubmit={onSubmit}>
            <IconButton type="plain" label="Close" icon={icon} className="close" onClick={onClick} />
        </form>);
        const button = screen.getByRole('button', { name: 'Close' });
        expect(button).toHaveClass('close');
        fireEvent.click(button);
        expect(onClick).toHaveBeenCalledOnce();
        expect(onSubmit).not.toHaveBeenCalled();
        expect(button).not.toHaveAttribute('title');
        expect(screen.queryByRole('tooltip')).toBeNull();
    });
});
