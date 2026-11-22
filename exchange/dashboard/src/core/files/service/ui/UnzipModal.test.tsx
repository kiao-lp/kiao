import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { UnzipModal } from './UnzipModal';

const renderModal = (props: Partial<React.ComponentProps<typeof UnzipModal>> = {}) => {
    const onAnswer = vi.fn();
    render(<UnzipModal zips={['archive/bundle.zip']} target="archive" onAnswer={onAnswer} {...props} />);
    return { onAnswer };
};

describe('UnzipModal', () => {
    it('renders nothing when no archive is waiting', () => {
        const { container } = render(<UnzipModal zips={null} target="archive" onAnswer={vi.fn()} />);
        expect(container.textContent).toBe('');
    });

    it('names the archive, the folder, and what extracting does', () => {
        renderModal();

        expect(screen.getByText('Unzip bundle.zip?')).toBeTruthy();
        expect(screen.getByTestId('unzip-names').textContent).toContain('archive');
        expect(screen.getByText(/already exist are overwritten/)).toBeTruthy();
        expect(screen.getByTestId('unzip-no')).toBeTruthy();
        expect(screen.getByTestId('unzip-yes')).toBeTruthy();
        expect(screen.getByTestId('unzip-yes-delete').textContent).toBe('Yes, and delete the archive');
    });

    it('answers each button with its own choice', async () => {
        const { onAnswer } = renderModal();

        await userEvent.click(screen.getByTestId('unzip-yes'));
        expect(onAnswer).toHaveBeenCalledWith('yes');

        await userEvent.click(screen.getByTestId('unzip-yes-delete'));
        expect(onAnswer).toHaveBeenCalledWith('yes-delete');

        await userEvent.click(screen.getByTestId('unzip-no'));
        expect(onAnswer).toHaveBeenCalledWith('no');
    });

    it('lists every archive when several were imported', () => {
        renderModal({ zips: ['archive/a.zip', 'archive/sub/b.zip'] });

        expect(screen.getByText('Unzip 2 archives?')).toBeTruthy();
        expect(screen.getByText('a.zip')).toBeTruthy();
        expect(screen.getByText('b.zip')).toBeTruthy();
        expect(screen.getByTestId('unzip-yes-delete').textContent).toBe('Yes, and delete the archives');
    });

    it('stays inert while an extraction runs', () => {
        renderModal({ busy: true });

        expect((screen.getByTestId('unzip-no') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTestId('unzip-yes') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTestId('unzip-yes-delete') as HTMLButtonElement).disabled).toBe(true);
    });
});
