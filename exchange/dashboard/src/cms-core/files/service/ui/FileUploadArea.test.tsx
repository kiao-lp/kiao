import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FileUploadArea } from './FileUploadArea';

vi.mock('kiao-worker', () => ({
    useWorkerClient: () => ({
        upload: vi.fn(),
        createFolder: vi.fn(),
    }),
}));

vi.mock('../../core/CurrentFileList-ctx', () => ({
    useRefreshFileList: () => vi.fn(),
}));

describe('FileUploadArea', () => {
    it('triggers folder input click when "Upload a folder…" button is clicked, without triggering file input', () => {
        const { container } = render(<FileUploadArea path="test" />);

        const fileInput = container.querySelector('input[type="file"]:not([webkitdirectory])') as HTMLInputElement;
        const folderInput = container.querySelector('input[type="file"][webkitdirectory]') as HTMLInputElement;

        expect(fileInput).not.toBeNull();
        expect(folderInput).not.toBeNull();

        const fileClickSpy = vi.spyOn(fileInput, 'click');
        const folderClickSpy = vi.spyOn(folderInput, 'click');

        const button = screen.getByText('Upload a folder…');
        fireEvent.click(button);

        expect(folderClickSpy).toHaveBeenCalledTimes(1);
        expect(fileClickSpy).not.toHaveBeenCalled();
    });

    it('triggers file input click when upload zone container is clicked', () => {
        const { container } = render(<FileUploadArea path="test" />);

        const fileInput = container.querySelector('input[type="file"]:not([webkitdirectory])') as HTMLInputElement;
        const folderInput = container.querySelector('input[type="file"][webkitdirectory]') as HTMLInputElement;

        const fileClickSpy = vi.spyOn(fileInput, 'click');
        const folderClickSpy = vi.spyOn(folderInput, 'click');

        const zone = container.querySelector('.kiao-upload-zone')!;
        fireEvent.click(zone);

        expect(fileClickSpy).toHaveBeenCalledTimes(1);
        expect(folderClickSpy).not.toHaveBeenCalled();
    });
});
