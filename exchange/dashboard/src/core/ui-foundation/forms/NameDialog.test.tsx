import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { NameDialog } from './NameDialog';

it('locks keyboard and button submission while saving and lets the user retry', async () => {
    let reject!: (cause: Error) => void;
    const save = vi.fn<(name: string) => Promise<void>>()
        .mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }))
        .mockResolvedValue(undefined);
    const Example = () => {
        const [open, setOpen] = useState(false);
        return <>
            <button onClick={() => setOpen(true)}>Open</button>
            <NameDialog open={open} title="Create item" label="Item name" okText="Create"
                onSubmit={save} onClose={() => setOpen(false)} />
        </>;
    };
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    trigger.focus();
    fireEvent.click(trigger);

    const input = screen.getByRole('textbox', { name: 'Item name' });
    const create = screen.getByRole('button', { name: 'Create' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: '  ' } });
    expect(create).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyUp(input, { key: 'Enter' });
    expect(save).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '  Weekly  ' } });
    act(() => {
        fireEvent.keyDown(input, { key: 'Enter' });
        fireEvent.click(create);
    });
    expect(save).toHaveBeenCalledExactlyOnceWith('Weekly');
    expect(input).toHaveAttribute('readonly');
    expect(cancel).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Escape', keyCode: 27 });

    await act(async () => { reject(new Error('Name already taken')); });
    expect(screen.getByRole('alert')).toHaveTextContent('Name already taken');
    expect(input).toHaveValue('  Weekly  ');
    fireEvent.change(input, { target: { value: 'Monthly' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(create);
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(save).toHaveBeenLastCalledWith('Monthly');

    fireEvent.click(trigger);
    expect(screen.getByRole('textbox', { name: 'Item name' })).toHaveValue('');
});
