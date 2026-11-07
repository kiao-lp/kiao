import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EditableBlock } from '@cms-core';
import { ArchDiaExtractModal } from './ArchDiaExtractModal';

// ArchDiaExtractModal: selection, preview and empty-block cases.
const fence = (body: string): EditableBlock => ({
    language: 'archdia',
    code: body,
    range: { start: 0, end: body.length },
});

const archdia = (...diagrams: Array<{ name?: string; source: string }>): EditableBlock =>
    fence([
        ...diagrams.map(d => `---\n${d.name ? `name: ${d.name}\n` : ''}type: PLANTUML\n---\n\`\`\`plantuml\n${d.source}\n\`\`\``),
        '---\ntype: LAYOUT\n---\n```json\n{ "size": { "width": 640, "height": 480 }, "positions": {} }\n```',
    ].join('\n===\n'));

const ALPHA = '@startuml\ncomponent "Alpha" as A\ncomponent "Beta" as B\nA --> B\n@enduml';
const GAMMA = '@startuml\ncomponent "Gamma" as G\n@enduml';

const open = (block: EditableBlock) => {
    const onConfirm = vi.fn();
    render(<ArchDiaExtractModal block={block} onCancel={vi.fn()} onConfirm={onConfirm} />);
    return onConfirm;
};

const preview = () => document.querySelector('.archdia-extract-preview')?.textContent ?? '';

describe('ArchDiaExtractModal', () => {
    it('hands over the diagram verbatim, leaving the wrapper behind', async () => {
        const onConfirm = open(archdia({ source: ALPHA }));

        expect(preview()).toBe(ALPHA);
        await userEvent.click(screen.getByRole('button', { name: 'Extract' }));

        expect(onConfirm).toHaveBeenCalledWith(ALPHA);
    });

    it('warns that the block is replaced', () => {
        open(archdia({ source: ALPHA }));
        expect(screen.getByText(/archdia block is replaced/)).toBeInTheDocument();
    });

    it('asks which diagram when the block holds several', async () => {
        const onConfirm = open(archdia({ name: 'Overview', source: ALPHA }, { name: 'Detail', source: GAMMA }));

        expect(preview()).toBe(ALPHA);
        expect(screen.getByText(/diagrams that are not the one chosen/)).toBeInTheDocument();

        await userEvent.click(screen.getByRole('radio', { name: 'Detail' }));

        expect(preview()).toBe(GAMMA);
        await userEvent.click(screen.getByRole('button', { name: 'Extract' }));
        expect(onConfirm).toHaveBeenCalledWith(GAMMA);
    });

    it('names a diagram its block did not name by its rank', () => {
        open(archdia({ source: ALPHA }, { source: GAMMA }));

        expect(screen.getByRole('radio', { name: 'Diagram 1' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Diagram 2' })).toBeInTheDocument();
    });

    it('does not ask when there is only one diagram', () => {
        open(archdia({ source: ALPHA }));
        expect(screen.queryByText('Which diagram')).toBeNull();
    });

    it('refuses a block holding no diagram', () => {
        open(fence('not an archdia block at all'));

        expect(screen.getByText(/no diagram to extract/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Extract' })).toBeDisabled();
    });

    it('stays closed without a block', () => {
        render(<ArchDiaExtractModal block={null} onCancel={vi.fn()} onConfirm={vi.fn()} />);
        expect(screen.queryByText('Extract diagram')).toBeNull();
    });
});
