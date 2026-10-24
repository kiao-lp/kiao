import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * The CMS's one instantiation panel: the fields on the left, the rendered markdown on the
 * right, Instantiate and Copy under them.
 *
 * What is pinned here is the contract every caller relies on: both buttons hand over the
 * markdown source the preview was rendered from, and what the caller bound is filled rather
 * than asked. The flow-node adapter's own tests pin its loading and its Copy being off.
 */

vi.mock('@cms-core', async importOriginal => ({
    ...(await importOriginal<typeof import('@cms-core')>()),
    useWorkerClient: () => ({ listFiles: async () => [], getFileJson: async () => [] }),
    useFileDrop: () => ({ dropping: false, dropProps: {} }),
    extractName: (path: string) => path.slice(path.lastIndexOf('/') + 1),
    VoiceTextArea: ({ value, onChange }: { value?: string; onChange?: (e: unknown) => void }) => (
        <textarea data-testid="value-field" value={value} onChange={onChange} />
    ),
}));

import { WorkerClientMockProvider } from 'kiao-worker';
import { globalTemplateStore, TemplateInstantiation } from './index';

const TEMPLATE = {
    name: 'Greeting',
    index: '',
    rootTemplate: { id: 'root', textTemplate: '# Hello ${who:text}!' },
    subTemplates: [],
};

const onInstantiate = vi.fn();
const writeText = vi.fn();

const show = (props?: { bound?: Record<string, { type: string; value: string }> }) => render(
    <WorkerClientMockProvider mock={{ workerClient: {} as any }}>
        <TemplateInstantiation
            template={TEMPLATE}
            bound={props?.bound}
            onInstantiate={onInstantiate}
        />
    </WorkerClientMockProvider>,
);

beforeEach(() => {
    vi.clearAllMocks();
    globalTemplateStore.setHeap({});
    globalTemplateStore.setEnabledMap({});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

describe('TemplateInstantiation', () => {
    it('asks the variables on the left and renders what they make on the right', () => {
        show();

        fireEvent.change(screen.getByTestId('value-field'), { target: { value: 'Alex' } });

        const preview = screen.getByTestId('template-preview');
        expect(preview.querySelector('h1')).toHaveTextContent('Hello Alex!');
    });

    it('hands the markdown source over, on Instantiate and on Copy', () => {
        show();
        fireEvent.change(screen.getByTestId('value-field'), { target: { value: 'Alex' } });

        fireEvent.click(screen.getByRole('button', { name: 'Instantiate' }));
        expect(onInstantiate).toHaveBeenCalledWith('# Hello Alex!');

        fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
        expect(writeText).toHaveBeenCalledWith('# Hello Alex!');
    });

    it('fills what the caller bound, and asks for nothing of it', () => {
        show({ bound: { who: { type: 'text', value: 'the team' } } });

        expect(screen.queryByTestId('value-field')).toBeNull();
        expect(screen.getByTestId('template-preview')).toHaveTextContent('Hello the team!');

        fireEvent.click(screen.getByRole('button', { name: 'Instantiate' }));
        expect(onInstantiate).toHaveBeenCalledWith('# Hello the team!');
        expect(globalTemplateStore.getSnapshot().heap.who).toBeUndefined();
    });
});
