import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemplatePersistenceProvider, useTemplatePersistenceContext } from './TemplatePersistence-ctx';
import { useWorkerClient } from '@cms-core';

vi.mock('@cms-core', () => ({ useWorkerClient: vi.fn() }));

const PATH = 'templates/greeting.temp.md';
const SOURCE = '# Greeting\n\n## template\n\nHello {{name}}\n';

const Probe = () => {
    const { template, setTemplate } = useTemplatePersistenceContext();
    return (
        <div>
            <span data-testid="name">{template?.name ?? ''}</span>
            <button onClick={() => setTemplate(prev => prev ? { ...prev, name: 'Renamed' } : prev)}>rename</button>
        </div>
    );
};

const update = vi.fn();

const renderProvider = () => render(
    <TemplatePersistenceProvider templateId={PATH}>
        <Probe />
    </TemplatePersistenceProvider>
);

describe('TemplatePersistence (autosave)', () => {
    beforeEach(() => {
        update.mockReset().mockResolvedValue(undefined);
        vi.mocked(useWorkerClient).mockReturnValue({
            getFileText: vi.fn().mockResolvedValue(SOURCE),
            update,
        } as any);
    });

    // The template editor has no Save button, like the rest of this CMS: a change is a write.
    it('writes an edit to the store on its own', async () => {
        renderProvider();
        await waitFor(() => expect(screen.getByTestId('name')).not.toHaveTextContent(''));

        fireEvent.click(screen.getByRole('button', { name: 'rename' }));

        await waitFor(
            () => expect(update).toHaveBeenCalledWith(PATH, expect.stringContaining('Renamed')),
            { timeout: 3000 },
        );
    });

    // Loading a template must not write it straight back: that would be a no-op commit on every
    // file the user so much as opens.
    it('does not write the template it has just loaded', async () => {
        renderProvider();
        await waitFor(() => expect(screen.getByTestId('name')).not.toHaveTextContent(''));

        await new Promise(resolve => setTimeout(resolve, 1500));
        expect(update).not.toHaveBeenCalled();
    });
});
