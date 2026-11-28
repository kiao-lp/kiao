import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AsyncList } from './AsyncList';

describe('AsyncList', () => {
    it('shows loading before empty, and displays the rows when ready', () => {
        const { rerender } = render(<AsyncList loading loadingLabel="Loading boards" empty="No boards yet." />);
        expect(screen.getByRole('status', { name: 'Loading boards' })).toHaveTextContent('Loading boards…');
        expect(screen.queryByText('No boards yet.')).toBeNull();

        rerender(<AsyncList empty={<>No <em>boards</em> yet.</>} />);
        expect(screen.getByRole('status')).toHaveTextContent('No boards yet.');

        rerender(<AsyncList><ul><li>Board A</li></ul></AsyncList>);
        expect(screen.getByRole('listitem')).toHaveTextContent('Board A');
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('keeps the error details visible and disables retry while the request is pending', () => {
        const retry = vi.fn();
        const error = { errorTitle: 'Could not read boards', error: 'Service unavailable', onRetry: retry };
        const { rerender } = render(<AsyncList {...error} />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(error.errorTitle);
        expect(alert).toHaveTextContent(error.error);
        fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
        expect(retry).toHaveBeenCalledOnce();

        rerender(<AsyncList {...error} loading retrying />);
        expect(screen.getByRole('alert')).toHaveTextContent(error.error);
        expect(within(alert).getByRole('button', { name: 'Try again' })).toBeDisabled();
        expect(screen.queryByRole('status')).toBeNull();
    });
});
