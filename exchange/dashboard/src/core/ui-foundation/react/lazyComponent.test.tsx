import React, { createContext, useContext, useEffect } from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { lazyComponent } from './lazyComponent';

describe('lazyComponent', () => {
    it('keeps neighbouring interfaces mounted and supplies the full context after loading', async () => {
        const Context = createContext('missing');
        let resolve!: (module: { default: React.FC<{ title: string }> }) => void;
        const load = vi.fn(() => new Promise<{ default: React.FC<{ title: string }> }>(done => { resolve = done; }));
        const Panel = lazyComponent(load);
        const unmounted = vi.fn();
        const Document = () => {
            useEffect(() => unmounted, []);
            return <input aria-label="document" defaultValue="draft" />;
        };

        render(<Context.Provider value="shared context">
            <Document />
            <Panel title="panel" />
        </Context.Provider>);

        const document = screen.getByLabelText('document');
        expect(document).toHaveValue('draft');
        expect(screen.getByRole('status')).toHaveTextContent('Loading');

        await act(async () => {
            resolve({ default: ({ title }) => <span>{title}: {useContext(Context)}</span> });
        });

        expect(screen.getByText('panel: shared context')).toBeVisible();
        expect(screen.getByLabelText('document')).toBe(document);
        expect(unmounted).not.toHaveBeenCalled();
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('contains a failed import within the interface that requested it', async () => {
        const logging = vi.spyOn(console, 'error').mockImplementation(() => {});
        const onError = (event: ErrorEvent) => {
            if (event.error?.message === 'panel unavailable') event.preventDefault();
        };
        window.addEventListener('error', onError);
        try {
            const Panel = lazyComponent(() => Promise.reject(new Error('panel unavailable')));
            render(<><span>document</span><Panel /></>);
            expect(await screen.findByText('panel unavailable')).toBeVisible();
            expect(screen.getByText('document')).toBeVisible();
        } finally {
            window.removeEventListener('error', onError);
            logging.mockRestore();
        }
    });
});
