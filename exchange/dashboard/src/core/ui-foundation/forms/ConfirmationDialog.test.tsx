import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ConfirmationProvider, useConfirmation } from './ConfirmationDialog';

const Trigger = ({ remove }: { remove: () => Promise<void> }) => {
    const confirm = useConfirmation();
    return <button onClick={() => confirm({ title: 'Delete the selection?', onConfirm: remove })}>Remove</button>;
};

it('focuses Cancel and returns focus to the trigger when dismissed', async () => {
    const remove = vi.fn();
    render(<Trigger remove={remove} />, { wrapper: ConfirmationProvider });
    const trigger = screen.getByRole('button', { name: 'Remove' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'Delete the selection?' });
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toHaveFocus());
    const accept = within(dialog).getByRole('button', { name: 'Delete' });
    fireEvent.keyDown(cancel, { key: 'Escape', keyCode: 27 });
    fireEvent.click(accept);

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(remove).not.toHaveBeenCalled();
});

it('locks a pending deletion and keeps the confirmation available after an error', async () => {
    let reject!: (error: Error) => void;
    const remove = vi.fn<() => Promise<void>>()
        .mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }))
        .mockResolvedValue(undefined);
    render(<Trigger remove={remove} />, { wrapper: ConfirmationProvider });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    const dialog = within(await screen.findByRole('dialog', { name: 'Delete the selection?' }));
    const accept = dialog.getByRole('button', { name: 'Delete' });
    const cancel = dialog.getByRole('button', { name: 'Cancel' });
    fireEvent.click(accept);
    expect(cancel).toBeDisabled();
    expect(accept).toBeDisabled();
    fireEvent.click(accept);
    fireEvent.keyDown(cancel, { key: 'Escape', keyCode: 27 });
    expect(remove).toHaveBeenCalledTimes(1);

    await act(async () => { reject(new Error('Deletion failed')); });
    expect(dialog.getByRole('alert')).toHaveTextContent('Deletion failed');
    expect(accept).toBeEnabled();
    fireEvent.click(accept);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(remove).toHaveBeenCalledTimes(2);
});
