import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./MindmapViewport', () => ({
    MindmapViewportCmp: () => <div data-testid="mindmap-viewport" />,
}));
vi.mock('./MindmapDragAndDrop', () => ({
    MindmapDragAndDropProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./RelationDrag-ctx', () => ({
    RelationDragProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { MindmapPanel } from './MindmapPanel';

describe('mindmap panel', () => {
    it('draws only the viewport, without a tab strip of its own', () => {
        const { container } = render(<MindmapPanel />);

        expect(screen.getByTestId('mindmap-viewport')).toBeInTheDocument();
        expect(container.querySelector('.ant-tabs')).toBeNull();
        expect(screen.queryByLabelText('Mindmap')).toBeNull();
    });
});
