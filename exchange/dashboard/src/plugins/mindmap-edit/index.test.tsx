import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const layout = vi.hoisted(() => ({ additionalPanels: null as React.ReactNode }));

vi.mock('@cms-core', () => ({
    extractFileNameFn: () => (file: { path: string }) => file.path,
    useFileBrowsingPersistenceContext: () => ({
        currentFile: { path: 'map.mmap.json', isDirectory: false, size: 0, lastModified: 0 },
        currentPath: '',
    }),
    LayoutContent: ({ children, additionalPanels }: { children: React.ReactNode; additionalPanels?: React.ReactNode }) => {
        layout.additionalPanels = additionalPanels ?? null;
        return <div>{children}</div>;
    },
    TopBanner: () => null,
}));

vi.mock('./state', () => ({
    MindmapStateProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./hotkeys', () => ({
    MindmapHotkeysProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./MindmapCreationPlugin', () => ({ MindmapCreationPlugin: () => null }));
vi.mock('./components/MindmapPanel', () => ({
    MindmapPanel: () => <div data-testid="mindmap-panel" />,
}));
vi.mock('./components/MindmapZoomControl', () => ({
    MindmapZoomControl: () => <div data-testid="control-zoom" />,
}));
vi.mock('./components/NewColorControl', () => ({
    NewColorControl: () => <div data-testid="control-color" />,
}));
vi.mock('./components/NewNoteStyleControl', () => ({
    NewNoteStyleControl: () => <div data-testid="control-note-style" />,
}));
vi.mock('./components/NewRelationStyleControl', () => ({
    NewRelationStyleControl: () => <div data-testid="control-relation-style" />,
}));

import { plugin } from './index';

describe('mindmap main view', () => {
    it('offers its defaults and zoom as document controls, not as a tab of its own', () => {
        const config = plugin.fileConfigFor({ path: 'map.mmap.json', isDirectory: false, size: 0, lastModified: 0 } as never);
        const MainView = config!.mainView as React.FC;
        render(<MainView />);

        const controls = render(<>{layout.additionalPanels}</>);
        for (const id of ['control-color', 'control-note-style', 'control-relation-style', 'control-zoom']) {
            expect(controls.getByTestId(id)).toBeInTheDocument();
        }
        expect(screen.getByTestId('mindmap-panel')).toBeInTheDocument();
    });
});
