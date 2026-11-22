import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TableOfContentsMenu } from './TableOfContentsMenu';

// TableOfContentsMenu: the document's headings in a menu, each navigating to its section.

const VALUE = '# Title\n\ntext\n\n## Part\n\n### Detail\n';

const opened = async (value = VALUE) => {
    const onNavigate = vi.fn();
    render(<TableOfContentsMenu value={value} onNavigate={onNavigate} />);
    await userEvent.click(screen.getByRole('button', { name: 'Table of Contents' }));
    return onNavigate;
};

describe('the table of contents menu', () => {
    it('lists every heading in document order', async () => {
        await opened();

        const items = screen.getAllByRole('menuitem').map(item => item.textContent);
        expect(items).toEqual(['Title', 'Part', 'Detail']);
    });

    it('navigates to the source line of the heading that was picked, and closes', async () => {
        const onNavigate = await opened();

        await userEvent.click(screen.getByText('Part'));

        expect(onNavigate).toHaveBeenCalledWith(5);
        // antd keeps the closed popup mounted; the hidden class is where "closed" shows.
        await waitFor(() => expect(document.querySelector('.ant-dropdown')).toHaveClass('ant-dropdown-hidden'));
    });

    it('offers nothing for a document without headings', () => {
        render(<TableOfContentsMenu value="just a paragraph" onNavigate={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Table of Contents' })).toBeDisabled();
    });
});
