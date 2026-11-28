import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ImagePasteModal } from './ImagePasteModal';

vi.mock('@kiao-dashboard-core', () => ({ ImagePreview: () => null }));
vi.mock('./imagePaste', async importOriginal => ({
    ...(await importOriginal<typeof import('./imagePaste')>()),
    blobToDataUrl: async () => 'data:image/png;base64,eA==',
    convertImage: async (blob: Blob) => ({ blob, dataUrl: 'data:image/png;base64,eA==', width: 1, height: 1 }),
}));

it('holds image options while inserting the selected file', async () => {
    let finish!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<ImagePasteModal image={new File(['x'], 'image.png', { type: 'image/png' })}
        defaultDirectory="notes" documentName="today.md" onCancel={vi.fn()} onConfirm={onConfirm} />);

    const insert = () => screen.getByRole('button', { name: 'Insert' });
    await waitFor(() => {
        expect(insert()).toBeEnabled();
        expect(insert()).not.toHaveClass('ant-btn-loading');
    });
    fireEvent.click(insert());

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(insert()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('image-paste-path')).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Inside the markdown/ })).toBeDisabled();
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    await act(async () => { finish(); });
    expect(insert()).toBeEnabled();
});
