/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { message } from 'antd';
import { afterEach, expect, it, vi } from 'vitest';
import { CopyTextButton } from './CopyButton';
import * as clipboard from './clipboard';

const button = () => screen.getByRole('button', { name: 'Copy source' });
const copy = () => act(async () => { fireEvent.click(button()); });

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

it('keeps the action name and restarts the confirmation on another successful copy', async () => {
    vi.useFakeTimers();
    const write = vi.spyOn(clipboard, 'setClipboard').mockResolvedValue(undefined);
    render(<CopyTextButton text="diagram" label="Copy source" />);

    await copy();
    act(() => { vi.advanceTimersByTime(1000); });
    await copy();
    expect(write.mock.calls).toEqual([['diagram'], ['diagram']]);
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByText('Copied')).toHaveAttribute('aria-live', 'polite');
    expect(button()).toBeEnabled();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByText('Copied')).toBeNull();
});

it('reports a refused write and clears the previous confirmation', async () => {
    const write = vi.spyOn(clipboard, 'setClipboard').mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Clipboard permission denied'));
    const error = vi.spyOn(message, 'error').mockImplementation(vi.fn());
    render(<CopyTextButton text="diagram" label="Copy source" />);

    await copy();
    expect(screen.getByText('Copied')).toBeInTheDocument();
    await copy();
    expect(write).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith('Could not copy to the clipboard');
    expect(screen.queryByText('Copied')).toBeNull();
});

it('ignores a clipboard result after the button is removed', async () => {
    let reject!: (reason: Error) => void;
    vi.spyOn(clipboard, 'setClipboard').mockReturnValue(new Promise((_, fail) => { reject = fail; }));
    const error = vi.spyOn(message, 'error').mockImplementation(vi.fn());
    const { unmount } = render(<CopyTextButton text="diagram" label="Copy source" />);

    await copy();
    unmount();
    await act(async () => { reject(new Error('Clipboard permission denied')); });
    expect(error).not.toHaveBeenCalled();
});
