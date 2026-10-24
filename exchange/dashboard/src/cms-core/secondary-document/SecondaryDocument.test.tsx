import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FileDto } from '../files/service';

const bars = vi.hoisted(() => ({
    centralCount: 1 as 1 | 2 | 3,
    setCentralCount: vi.fn(),
    activate: vi.fn(),
}));

vi.mock('../core/ActivePlugin', async () => {
    const { Children } = await import('src/test/mocks');
    return { ActivePluginProvider: Children };
});
vi.mock('../tool-bars/ToolBars-ctx', async (importOriginal) => {
    const original = await importOriginal<typeof import('../tool-bars/ToolBars-ctx')>();
    return { ...original, useToolBarsOptional: () => bars };
});

import { LayoutContent } from '../core/LayoutContent';
import { ScopedFileBrowsingProvider, useFileBrowsingPersistenceContext } from '../files/core/FileBrowsingPersistence-ctx';
import { PluginListProvider } from '../core/PluginList-ctx';
import { SecondaryDocumentProvider, useSecondaryDocument } from './SecondaryDocument-ctx';
import { SecondaryDocumentPanel, SecondaryDocumentReveal, secondaryDocumentTab } from './SecondaryDocumentPanel';

const file = (path: string, isDirectory = false): FileDto => ({ path, isDirectory, size: 0, lastModified: 0 });

const FakeMainView: React.FC = () => {
    const { currentFile } = useFileBrowsingPersistenceContext();
    return (
        <LayoutContent>
            <div data-testid="secondary-content">{currentFile?.path}</div>
        </LayoutContent>
    );
};

const fakePlugin = {
    fileConfigFor: (candidate: FileDto) => candidate.path.endsWith('.md')
        ? { fileLabelCmp: () => null, mainView: FakeMainView }
        : null,
};

const Opener: React.FC<{ target: FileDto }> = ({ target }) => {
    const secondary = useSecondaryDocument();
    return <button data-testid="open-secondary" onClick={() => secondary.open(target)}>open</button>;
};

const PrimaryProbe: React.FC = () => {
    const { currentFile } = useFileBrowsingPersistenceContext();
    return <div data-testid="primary-content">{currentFile?.path}</div>;
};

const harness = (target: FileDto) => (
    <PluginListProvider plugins={[fakePlugin as never]}>
        <SecondaryDocumentProvider>
            <ScopedFileBrowsingProvider value={{ currentFile: file('main.md'), currentPath: '' }}>
                <PrimaryProbe />
                <SecondaryDocumentPanel />
                <Opener target={target} />
                <SecondaryDocumentReveal />
            </ScopedFileBrowsingProvider>
        </SecondaryDocumentProvider>
    </PluginListProvider>
);

describe('secondary document', () => {
    it('is pinned to the second central area', () => {
        expect(secondaryDocumentTab).toMatchObject({
            id: 'secondary-document',
            title: 'Secondary document',
            defaultBar: 'center-2',
            pinned: true,
        });
    });

    it('shows the file opened as secondary while the primary stays in place', () => {
        bars.centralCount = 1;
        bars.setCentralCount.mockClear();
        bars.activate.mockClear();
        render(harness(file('notes/ref.md')));

        expect(screen.getByTestId('secondary-document-panel')).toHaveTextContent('No secondary document');

        fireEvent.click(screen.getByTestId('open-secondary'));

        expect(screen.getByTestId('secondary-content')).toHaveTextContent('notes/ref.md');
        expect(screen.getByTestId('primary-content')).toHaveTextContent('main.md');
        expect(screen.queryByText('ref.md')).toBeNull();
        expect(bars.setCentralCount).toHaveBeenCalledWith(2);
    });

    it('activates its area once it exists and closes back to empty', () => {
        bars.centralCount = 2;
        bars.setCentralCount.mockClear();
        bars.activate.mockClear();
        render(harness(file('notes/ref.md')));
        fireEvent.click(screen.getByTestId('open-secondary'));

        expect(bars.activate).toHaveBeenCalledWith('center-2', 'secondary-document');

        fireEvent.click(screen.getByTestId('close-secondary-document'));
        expect(screen.queryByTestId('secondary-content')).toBeNull();
        expect(screen.getByTestId('secondary-document-panel')).toHaveTextContent('No secondary document');
    });

    it('does not open folders', () => {
        render(harness(file('notes', true)));
        fireEvent.click(screen.getByTestId('open-secondary'));
        expect(screen.queryByTestId('secondary-content')).toBeNull();
        expect(screen.getByTestId('secondary-document-panel')).toHaveTextContent('No secondary document');
    });
});
